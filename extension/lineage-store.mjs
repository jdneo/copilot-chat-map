import { randomUUID } from "node:crypto";
import {
    mkdir,
    open,
    readFile,
    rename,
    rm,
    stat,
    unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { isValidLocalSessionId } from "./event-reader.mjs";

const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 10_000;
const MALFORMED_LOCK_STALE_MS = 120_000;

export function resolveLineagePath({
    env = process.env,
    homedir = os.homedir(),
} = {}) {
    const copilotHome = env.COPILOT_HOME || path.join(homedir, ".copilot");
    return path.join(
        copilotHome,
        "extensions",
        "chat-fork-map",
        "artifacts",
        "lineage-v1.json",
    );
}

export function createLineageStore({
    filePath = resolveLineagePath(),
    lockTimeoutMs = LOCK_TIMEOUT_MS,
} = {}) {
    const lockPath = `${filePath}.lock`;

    async function read() {
        return readIndex(filePath);
    }

    async function withLock(callback) {
        await mkdir(path.dirname(filePath), { recursive: true });
        const lock = await acquireLock(lockPath, lockTimeoutMs);
        let result;
        let callbackError;

        try {
            const transaction = createTransaction(filePath, await readIndex(filePath));
            result = await callback(transaction);
        } catch (error) {
            callbackError = error;
        }

        let releaseError;
        try {
            await lock.close();
            await unlink(lockPath);
        } catch (error) {
            releaseError = error;
        }

        if (callbackError && releaseError) {
            throw new AggregateError(
                [callbackError, releaseError],
                "Lineage transaction and lock release both failed.",
            );
        }
        if (callbackError) throw callbackError;
        if (releaseError) throw releaseError;
        return result;
    }

    async function recordFork(record) {
        return withLock((transaction) => transaction.recordFork(record));
    }

    return { read, recordFork, withLock };
}

function createTransaction(filePath, initialIndex) {
    let index = initialIndex;

    return {
        read() {
            return structuredClone(index);
        },
        nextSiblingOrdinal(checkpoint) {
            const familyId = index.sessionToFamily[checkpoint.parentSessionId];
            if (!familyId) return 1;
            const family = index.families[familyId];
            if (!family) {
                throw new Error(
                    `Lineage family ${familyId} is missing for ${checkpoint.parentSessionId}.`,
                );
            }
            const siblingCount = Object.values(family.members).filter(
                (member) =>
                    member.parentSessionId === checkpoint.parentSessionId &&
                    member.sourceUserEventId === checkpoint.sourceUserEventId &&
                    member.sourceAssistantEventId ===
                        checkpoint.sourceAssistantEventId,
            ).length;
            return siblingCount + 1;
        },
        async recordFork(record) {
            index = addFork(index, record);
            await writeIndex(filePath, index);
            return structuredClone(index);
        },
    };
}

function emptyIndex() {
    return {
        version: 1,
        revision: 0,
        families: {},
        sessionToFamily: {},
    };
}

async function readIndex(filePath) {
    let text;
    try {
        text = await readFile(filePath, "utf8");
    } catch (error) {
        if (hasCode(error, "ENOENT")) return emptyIndex();
        throw error;
    }

    const index = JSON.parse(text);
    validateIndex(index, filePath);
    return index;
}

function addFork(index, record) {
    if (record.parentSessionId === record.childSessionId) {
        throw new TypeError("A session cannot be its own lineage parent.");
    }

    const next = structuredClone(index);
    const existingChildFamily = next.sessionToFamily[record.childSessionId];
    if (existingChildFamily) {
        const existing = next.families[existingChildFamily]?.members[
            record.childSessionId
        ];
        if (
            existing?.parentSessionId === record.parentSessionId &&
            existing.sourceUserEventId === record.sourceUserEventId &&
            existing.sourceAssistantEventId === record.sourceAssistantEventId
        ) {
            return next;
        }
        throw new TypeError(
            `Session ${record.childSessionId} already belongs to a Conversation Family.`,
        );
    }

    const familyId =
        next.sessionToFamily[record.parentSessionId] || record.parentSessionId;
    let family = next.families[familyId];
    if (!family) {
        family = {
            familyId,
            rootSessionId: record.parentSessionId,
            createdAt: record.createdAt,
            members: {
                [record.parentSessionId]: {
                    sessionId: record.parentSessionId,
                    parentSessionId: null,
                    sourceUserEventId: null,
                    sourceAssistantEventId: null,
                    toEventId: null,
                    childForkMarkerEventId: null,
                    siblingOrdinal: 0,
                    createdAt: record.createdAt,
                },
            },
            hiddenSessionIds: [],
        };
        next.families[familyId] = family;
        next.sessionToFamily[record.parentSessionId] = familyId;
    } else if (!family.members[record.parentSessionId]) {
        throw new TypeError(
            `Parent session ${record.parentSessionId} is not in family ${familyId}.`,
        );
    }

    family.members[record.childSessionId] = {
        sessionId: record.childSessionId,
        parentSessionId: record.parentSessionId,
        sourceUserEventId: record.sourceUserEventId,
        sourceAssistantEventId: record.sourceAssistantEventId,
        toEventId: record.toEventId,
        childForkMarkerEventId: record.childForkMarkerEventId,
        siblingOrdinal: record.siblingOrdinal,
        createdAt: record.createdAt,
    };
    next.sessionToFamily[record.childSessionId] = familyId;
    next.revision += 1;
    return next;
}

async function writeIndex(filePath, index) {
    validateIndex(index, filePath);
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    try {
        handle = await open(temporaryPath, "wx");
        await handle.writeFile(`${JSON.stringify(index, null, 2)}\n`, "utf8");
        await handle.sync();
        await handle.close();
        handle = undefined;
        await rename(temporaryPath, filePath);
    } catch (error) {
        let cleanupError;
        try {
            if (handle) await handle.close();
            await rm(temporaryPath, { force: true });
        } catch (cleanupFailure) {
            cleanupError = cleanupFailure;
        }
        if (cleanupError) {
            throw new AggregateError(
                [error, cleanupError],
                "Atomic lineage write and cleanup both failed.",
            );
        }
        throw error;
    }
}

async function acquireLock(lockPath, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (true) {
        let handle;
        try {
            handle = await open(lockPath, "wx");
        } catch (error) {
            if (!hasCode(error, "EEXIST")) throw error;
            if (await reclaimStaleLock(lockPath)) continue;
            if (Date.now() >= deadline) {
                throw new Error(
                    "Timed out waiting for the Conversation Fork Map lineage lock.",
                    { cause: error },
                );
            }
            await delay(LOCK_RETRY_MS);
            continue;
        }

        try {
            await handle.writeFile(
                JSON.stringify({
                    pid: process.pid,
                    createdAt: new Date().toISOString(),
                }),
                "utf8",
            );
            await handle.sync();
            return handle;
        } catch (error) {
            let cleanupError;
            try {
                await handle.close();
                await unlink(lockPath);
            } catch (cleanupFailure) {
                cleanupError = cleanupFailure;
            }
            if (cleanupError) {
                throw new AggregateError(
                    [error, cleanupError],
                    "Lineage lock initialization and cleanup both failed.",
                );
            }
            throw error;
        }
    }
}

async function reclaimStaleLock(lockPath) {
    let contents;
    let lockStat;
    try {
        [contents, lockStat] = await Promise.all([
            readFile(lockPath, "utf8"),
            stat(lockPath),
        ]);
    } catch (error) {
        if (hasCode(error, "ENOENT")) return true;
        throw error;
    }

    let owner;
    try {
        owner = JSON.parse(contents);
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
    }

    const hasOwnerPid = Number.isInteger(owner?.pid) && owner.pid > 0;
    if (hasOwnerPid && isProcessAlive(owner.pid)) return false;
    if (
        !hasOwnerPid &&
        Date.now() - lockStat.mtimeMs < MALFORMED_LOCK_STALE_MS
    ) {
        return false;
    }

    let confirmedContents;
    try {
        confirmedContents = await readFile(lockPath, "utf8");
    } catch (error) {
        if (hasCode(error, "ENOENT")) return true;
        throw error;
    }
    if (confirmedContents !== contents) return false;

    try {
        await unlink(lockPath);
        return true;
    } catch (error) {
        if (hasCode(error, "ENOENT")) return true;
        throw error;
    }
}

function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if (hasCode(error, "ESRCH") || hasCode(error, "EINVAL")) return false;
        if (hasCode(error, "EPERM")) return true;
        throw error;
    }
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function hasCode(error, code) {
    return Boolean(error && typeof error === "object" && error.code === code);
}

function isRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validateIndex(index, filePath) {
    let valid =
        index?.version === 1 &&
        Number.isInteger(index.revision) &&
        index.revision >= 0 &&
        isRecord(index.families) &&
        isRecord(index.sessionToFamily);
    const indexedSessions = new Set();

    if (valid) {
        for (const [familyId, family] of Object.entries(index.families)) {
            if (
                !isValidLocalSessionId(familyId) ||
                !isRecord(family) ||
                family.familyId !== familyId ||
                family.rootSessionId !== familyId ||
                typeof family.createdAt !== "string" ||
                !isRecord(family.members) ||
                !Array.isArray(family.hiddenSessionIds) ||
                !family.hiddenSessionIds.every(
                    (sessionId) =>
                        typeof sessionId === "string" &&
                        isValidLocalSessionId(sessionId),
                )
            ) {
                valid = false;
                break;
            }

            const root = family.members[familyId];
            if (!isValidMember(root, familyId, true)) {
                valid = false;
                break;
            }

            for (const [sessionId, member] of Object.entries(family.members)) {
                if (
                    indexedSessions.has(sessionId) ||
                    !isValidMember(member, sessionId, sessionId === familyId) ||
                    index.sessionToFamily[sessionId] !== familyId
                ) {
                    valid = false;
                    break;
                }
                indexedSessions.add(sessionId);
            }
            if (!valid || familyHasCycle(family)) {
                valid = false;
                break;
            }
        }
    }

    if (
        valid &&
        Object.entries(index.sessionToFamily).some(
            ([sessionId, familyId]) =>
                !indexedSessions.has(sessionId) ||
                !Object.hasOwn(index.families, familyId),
        )
    ) {
        valid = false;
    }

    if (!valid) {
        throw new TypeError(`Invalid Conversation Fork Map lineage at ${filePath}.`);
    }
}

function isValidMember(member, sessionId, isRoot) {
    if (
        !isValidLocalSessionId(sessionId) ||
        !isRecord(member) ||
        member.sessionId !== sessionId ||
        typeof member.createdAt !== "string" ||
        !Number.isInteger(member.siblingOrdinal) ||
        member.siblingOrdinal < 0 ||
        !isNullableString(member.toEventId) ||
        !isNullableString(member.childForkMarkerEventId)
    ) {
        return false;
    }
    if (isRoot) {
        return (
            member.parentSessionId === null &&
            member.sourceUserEventId === null &&
            member.sourceAssistantEventId === null &&
            member.siblingOrdinal === 0
        );
    }
    return (
        typeof member.parentSessionId === "string" &&
        isValidLocalSessionId(member.parentSessionId) &&
        typeof member.sourceUserEventId === "string" &&
        typeof member.sourceAssistantEventId === "string" &&
        member.siblingOrdinal > 0
    );
}

function familyHasCycle(family) {
    for (const sessionId of Object.keys(family.members)) {
        const path = new Set();
        let currentId = sessionId;
        while (currentId !== family.rootSessionId) {
            if (path.has(currentId)) return true;
            path.add(currentId);
            const parentId = family.members[currentId]?.parentSessionId;
            if (
                typeof parentId !== "string" ||
                !Object.hasOwn(family.members, parentId)
            ) {
                return true;
            }
            currentId = parentId;
        }
    }
    return false;
}

function isNullableString(value) {
    return value === null || typeof value === "string";
}
