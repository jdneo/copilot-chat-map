import { forkSession } from "./runtime.mjs";
import { groupTurns } from "./transcript.mjs";

const MAX_BRANCH_STEM_LENGTH = 48;

export function createForkService({
    session,
    lineageStore,
    readEvents,
    now = () => new Date(),
}) {
    const operationsById = new Map();
    const pendingOperationsByCheckpoint = new Map();
    const partialResultsByCheckpoint = new Map();

    function forkFromTurn(request) {
        validateRequest(request);
        const checkpointKey = `${request.sessionId}:${request.turnId}`;
        const partialResult = partialResultsByCheckpoint.get(checkpointKey);
        if (partialResult) return Promise.resolve(partialResult);

        const existingById = operationsById.get(request.operationId);
        if (existingById) {
            if (existingById.checkpointKey !== checkpointKey) {
                throw new TypeError(
                    "Fork operation ID was already used for another checkpoint.",
                );
            }
            return existingById.promise;
        }
        const existingCheckpoint =
            pendingOperationsByCheckpoint.get(checkpointKey);
        if (existingCheckpoint) {
            operationsById.set(request.operationId, {
                checkpointKey,
                promise: existingCheckpoint,
            });
            return existingCheckpoint;
        }

        const operation = runFork(request)
            .then((result) => {
                if (result.kind === "lineage_failed") {
                    partialResultsByCheckpoint.set(checkpointKey, result);
                }
                return result;
            })
            .finally(() => {
                if (
                    pendingOperationsByCheckpoint.get(checkpointKey) ===
                    operation
                ) {
                    pendingOperationsByCheckpoint.delete(checkpointKey);
                }
            });
        operationsById.set(request.operationId, {
            checkpointKey,
            promise: operation,
        });
        pendingOperationsByCheckpoint.set(checkpointKey, operation);
        return operation;
    }

    async function runFork(request) {
        let child;
        let name;
        let lineageDurable = false;

        try {
            if (
                request.sessionId !== session.sessionId &&
                !(await isFamilyMemberSource(
                    lineageStore,
                    session.sessionId,
                    request.sessionId,
                ))
            ) {
                return {
                    kind: "fork_failed",
                    message:
                        "The selected session is not an available member of this Conversation Family.",
                };
            }

            const activity =
                request.sessionId === session.sessionId
                    ? await session.rpc.metadata.isProcessing()
                    : { processing: false };
            if (activity.processing) {
                return {
                    kind: "fork_failed",
                    message:
                        "Wait for the active agent turn to finish before creating a branch.",
                };
            }

            const events = await readEvents(request.sessionId);
            const turns = groupTurns(events);
            const turn = turns.find((candidate) => candidate.id === request.turnId);
            if (
                !turn ||
                turn.status !== "completed" ||
                !turn.assistantEventId
            ) {
                return {
                    kind: "fork_failed",
                    message:
                        "The selected Turn Node is not an available Fork Checkpoint.",
                };
            }

            await lineageStore.withLock(async (transaction) => {
                const siblingOrdinal = transaction.nextSiblingOrdinal({
                    parentSessionId: request.sessionId,
                    sourceUserEventId: turn.userEventId,
                    sourceAssistantEventId: turn.assistantEventId,
                });
                name = branchName(turn.userContent, siblingOrdinal);
                const forkParams = {
                    sessionId: request.sessionId,
                    ...(turn.toEventId ? { toEventId: turn.toEventId } : {}),
                    name,
                };
                const result = await forkSession(session, forkParams);
                if (!result?.sessionId) {
                    throw new Error("The Copilot runtime returned no child session ID.");
                }
                child = result;

                const childForkMarkerEventId = await readForkMarker(
                    readEvents,
                    child.sessionId,
                );
                await transaction.recordFork({
                    parentSessionId: request.sessionId,
                    childSessionId: child.sessionId,
                    sourceUserEventId: turn.userEventId,
                    sourceAssistantEventId: turn.assistantEventId,
                    toEventId: turn.toEventId,
                    childForkMarkerEventId,
                    siblingOrdinal,
                    createdAt: now().toISOString(),
                });
                lineageDurable = true;
            });
        } catch (error) {
            if (!child) {
                return {
                    kind: "fork_failed",
                    message: errorMessage("Could not create the child session.", error),
                };
            }
            if (!lineageDurable) {
                return {
                    kind: "lineage_failed",
                    childSessionId: child.sessionId,
                    name: name || child.name || "Created child session",
                    message: errorMessage(
                        `Child session ${child.sessionId} was created, but its lineage could not be recorded. Open it manually from the session list; do not retry this fork.`,
                        error,
                    ),
                };
            }
            return {
                kind: "navigation_failed",
                childSessionId: child.sessionId,
                name,
                message: errorMessage(
                    `Child session ${child.sessionId} and its lineage are ready, but navigation was not requested. Open it manually from the session list.`,
                    error,
                ),
            };
        }

        try {
            const navigation = await session.rpc.commands.enqueue({
                command: `/resume ${child.sessionId}`,
            });
            if (!navigation?.queued) {
                throw new Error("The host did not accept the resume command.");
            }
        } catch (error) {
            return {
                kind: "navigation_failed",
                childSessionId: child.sessionId,
                name,
                message: errorMessage(
                    `Child session ${child.sessionId} is ready. Open it manually from the session list.`,
                    error,
                ),
            };
        }

        return {
            kind: "created",
            childSessionId: child.sessionId,
            name,
            navigation: "requested",
        };
    }

    return { forkFromTurn };
}

export function branchName(userContent, siblingOrdinal) {
    const normalized = userContent
        .replace(/\s/gu, " ")
        .replace(/\p{Cc}/gu, "")
        .replace(/ +/g, " ")
        .trim();
    if (!normalized) return `Untitled branch ${siblingOrdinal}`;
    const stem = Array.from(normalized)
        .slice(0, MAX_BRANCH_STEM_LENGTH)
        .join("");
    return `${stem} · Branch ${siblingOrdinal}`;
}

async function readForkMarker(readEvents, childSessionId) {
    let events;
    try {
        events = await readEvents(childSessionId);
    } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
    return (
        events.findLast(
            (event) =>
                event.type === "session.info" &&
                event.data?.infoType === "fork",
        )?.id || null
    );
}

function validateRequest(request) {
    if (!request || typeof request !== "object") {
        throw new TypeError("Fork request must be an object.");
    }
    for (const field of ["operationId", "sessionId", "turnId"]) {
        if (typeof request[field] !== "string" || !request[field].trim()) {
            throw new TypeError(`Fork request ${field} must be a non-empty string.`);
        }
    }
}

async function isFamilyMemberSource(
    lineageStore,
    currentSessionId,
    sourceSessionId,
) {
    const lineage = await lineageStore.read();
    const currentFamilyId = lineage.sessionToFamily[currentSessionId];
    return (
        typeof currentFamilyId === "string" &&
        lineage.sessionToFamily[sourceSessionId] === currentFamilyId &&
        Boolean(lineage.families[currentFamilyId]?.members[sourceSessionId])
    );
}

function errorMessage(message, error) {
    const detail =
        error instanceof Error && error.message ? ` ${error.message}` : "";
    return `${message}${detail}`;
}
