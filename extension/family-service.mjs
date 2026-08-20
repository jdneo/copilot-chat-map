import { readSessionEvents } from "./event-reader.mjs";
import { createLineageStore } from "./lineage-store.mjs";
import {
    canCheckSessionsInUse,
    canForkSession,
    canListSessions,
    checkSessionsInUse,
    listLocalSessions,
} from "./runtime.mjs";
import { groupTurns } from "./transcript.mjs";

/** @typedef {import("@github/copilot-sdk").CopilotSession} JoinedSession */

/**
 * @typedef {{
 *   id: string,
 *   userEventId: string,
 *   assistantEventId: string | null,
 *   toEventId: string | null,
 *   userContent: string,
 *   assistantContent: string,
 *   status: "completed" | "incomplete",
 *   executionDetails: unknown[]
 * }} TurnNode
 */

/**
 * @typedef {{
 *   kind: "ready",
 *   canFork: boolean,
 *   currentSessionId: string,
 *   family: { id: string, rootSessionId: string },
 *   session: { id: string, title: string },
 *   lanes: object[],
 *   turns: TurnNode[],
 *   updatedAt: string
 * }} ReadyMap
 */

/** @typedef {{ kind: "unsupported" | "error", message: string }} UnavailableMap */
/** @typedef {ReadyMap | UnavailableMap} CurrentSessionMap */

/** @type {Array<[string, (session: JoinedSession) => boolean]>} */
const REQUIRED_CAPABILITIES = [
    ["Canvas renderer", (session) => session.capabilities.ui?.canvases === true],
    [
        "canvas.open",
        (session) => typeof session.rpc.canvas?.open === "function",
    ],
    [
        "metadata.snapshot",
        (session) => typeof session.rpc.metadata?.snapshot === "function",
    ],
    [
        "metadata.isProcessing",
        (session) => typeof session.rpc.metadata?.isProcessing === "function",
    ],
    [
        "name.get",
        (session) => typeof session.rpc.name?.get === "function",
    ],
    [
        "sessions.fork",
        (session) => canForkSession(session),
    ],
];

/**
 * @param {JoinedSession} session
 * @param {{
 *   lineageStore?: ReturnType<typeof createLineageStore>,
 *   readEvents?: typeof readSessionEvents,
 *   listSessions?: () => Promise<object[]>,
 *   checkInUse?: (sessionIds: string[]) => Promise<Set<string>>
 * }} [dependencies]
 * @returns {Promise<CurrentSessionMap>}
 */
export async function loadCurrentSessionMap(
    session,
    dependencies = {},
) {
    const {
        lineageStore = createLineageStore(),
        readEvents = readSessionEvents,
        listSessions = () => listLocalSessions(session),
        checkInUse = (sessionIds) => checkSessionsInUse(session, sessionIds),
    } = dependencies;
    const missingCapabilities = REQUIRED_CAPABILITIES.filter(
        ([, isAvailable]) => !isAvailable(session),
    ).map(([name]) => name);
    if (!dependencies.listSessions && !canListSessions(session)) {
        missingCapabilities.push("sessions.list");
    }
    if (!dependencies.checkInUse && !canCheckSessionsInUse(session)) {
        missingCapabilities.push("sessions.checkInUse");
    }

    if (missingCapabilities.length > 0) {
        return {
            kind: "unsupported",
            message: `Conversation Fork Map requires Copilot 1.0.80+ with ${missingCapabilities.join(", ")}.`,
        };
    }

    let metadata;
    let name;
    let activity;
    let lineage;
    let listedSessions;
    try {
        [metadata, name, activity, lineage, listedSessions] = await Promise.all([
            session.rpc.metadata.snapshot(),
            session.rpc.name.get(),
            session.rpc.metadata.isProcessing(),
            lineageStore.read(),
            listSessions(),
        ]);
    } catch (error) {
        return errorState("Could not restore the Conversation Family.", error);
    }

    if (metadata.isRemote) {
        return {
            kind: "unsupported",
            message:
                "Conversation Fork Map supports local Copilot sessions only.",
        };
    }

    try {
        const familyId = lineage.sessionToFamily[session.sessionId];
        const family = familyId
            ? lineage.families[familyId]
            : untrackedFamily(session.sessionId);
        if (!family) {
            throw new TypeError(
                `Conversation Family ${familyId} is missing for ${session.sessionId}.`,
            );
        }

        const members = orderedMembers(family);
        const sessionIds = members.map((member) => member.sessionId);
        const inUse = await checkInUse(sessionIds);
        const metadataById = new Map(
            listedSessions.map((entry) => [entry.sessionId, entry]),
        );
        metadataById.set(session.sessionId, {
            ...metadataById.get(session.sessionId),
            sessionId: session.sessionId,
            name: name.name || metadataById.get(session.sessionId)?.name,
            summary:
                metadata.summary ||
                metadataById.get(session.sessionId)?.summary ||
                metadata.initialName,
            modifiedTime:
                metadata.modifiedTime ||
                metadataById.get(session.sessionId)?.modifiedTime,
            isRemote: metadata.isRemote,
        });

        const eventsById = new Map();
        await Promise.all(
            members.map(async (member) => {
                try {
                    eventsById.set(
                        member.sessionId,
                        await readEvents(member.sessionId),
                    );
                } catch (error) {
                    if (!hasCode(error, "ENOENT")) throw error;
                    eventsById.set(member.sessionId, null);
                }
            }),
        );

        const turnsById = new Map();
        const lanes = members.map((member) => {
            const sessionMetadata = metadataById.get(member.sessionId);
            const events = eventsById.get(member.sessionId);
            const available = Boolean(
                sessionMetadata && !sessionMetadata.isRemote && events,
            );
            const parentTurns = member.parentSessionId
                ? turnsById.get(member.parentSessionId) || []
                : [];
            const checkpointIndex = member.parentSessionId
                ? parentTurns.findIndex(
                      (turn) => turn.id === member.sourceUserEventId,
                  )
                : -1;
            const checkpoint =
                checkpointIndex >= 0 ? parentTurns[checkpointIndex] : null;
            if (
                member.parentSessionId &&
                eventsById.get(member.parentSessionId) &&
                (!checkpoint ||
                    checkpoint.assistantEventId !==
                        member.sourceAssistantEventId ||
                    (member.toEventId !== null &&
                        checkpoint.toEventId !== member.toEventId))
            ) {
                throw new TypeError(
                    `Fork checkpoint is contradictory for child session ${member.sessionId}.`,
                );
            }
            const inheritedTurnCount =
                member.parentSessionId && checkpointIndex >= 0
                    ? checkpointIndex + 1
                    : 0;
            const laneEvents =
                events && member.parentSessionId
                    ? incrementalEvents(
                          events,
                          eventsById.get(member.parentSessionId),
                          member,
                          checkpoint,
                      )
                    : events || [];
            const turns = available
                ? groupTurns(laneEvents, {
                      isProcessing:
                          member.sessionId === session.sessionId &&
                          activity.processing,
                  })
                : [];
            turnsById.set(member.sessionId, turns);

            return {
                session: {
                    id: member.sessionId,
                    title:
                        sessionMetadata?.name ||
                        sessionMetadata?.summary ||
                        (available ? "Untitled session" : "Session unavailable"),
                    summary: sessionMetadata?.summary || "",
                    modifiedTime: sessionMetadata?.modifiedTime || null,
                    available,
                    inUse: inUse.has(member.sessionId),
                    current: member.sessionId === session.sessionId,
                },
                parentSessionId: member.parentSessionId,
                inheritedTurnCount,
                sourceCheckpoint: member.parentSessionId
                    ? {
                          sessionId: member.parentSessionId,
                          turnId: member.sourceUserEventId,
                          available: checkpointIndex >= 0,
                      }
                    : null,
                turns,
            };
        });

        const currentLane = lanes.find((lane) => lane.session.current);
        if (!currentLane) {
            throw new TypeError(
                `Current session ${session.sessionId} is not in its Conversation Family.`,
            );
        }
        return {
            kind: "ready",
            canFork: !activity.processing,
            currentSessionId: session.sessionId,
            family: {
                id: family.familyId,
                rootSessionId: family.rootSessionId,
            },
            session: currentLane.session,
            lanes,
            turns: currentLane.turns,
            updatedAt: new Date().toISOString(),
        };
    } catch (error) {
        if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ENOENT"
        ) {
            return {
                kind: "unsupported",
                message:
                    "The current session does not have a readable local event log.",
            };
        }

        return errorState("Could not read the current session event log.", error);
    }
}

function untrackedFamily(sessionId) {
    return {
        familyId: sessionId,
        rootSessionId: sessionId,
        members: {
            [sessionId]: {
                sessionId,
                parentSessionId: null,
                sourceUserEventId: null,
                sourceAssistantEventId: null,
                toEventId: null,
                childForkMarkerEventId: null,
                siblingOrdinal: 0,
                createdAt: new Date(0).toISOString(),
            },
        },
    };
}

function orderedMembers(family) {
    const ordered = [];
    const visit = (parentSessionId) => {
        Object.values(family.members)
            .filter((member) => member.parentSessionId === parentSessionId)
            .sort(
                (left, right) =>
                    left.siblingOrdinal - right.siblingOrdinal ||
                    left.createdAt.localeCompare(right.createdAt) ||
                    left.sessionId.localeCompare(right.sessionId),
            )
            .forEach((member) => {
                ordered.push(member);
                visit(member.sessionId);
            });
    };
    const root = family.members[family.rootSessionId];
    if (!root) {
        throw new TypeError(
            `Conversation Family ${family.familyId} has no root member.`,
        );
    }
    ordered.push(root);
    visit(root.sessionId);
    if (ordered.length !== Object.keys(family.members).length) {
        throw new TypeError(
            `Conversation Family ${family.familyId} is not a connected tree.`,
        );
    }
    return ordered;
}

function incrementalEvents(childEvents, parentEvents, member, checkpoint) {
    const markerIndex = childEvents.findIndex(
        (event) => event.id === member.childForkMarkerEventId,
    );
    if (markerIndex >= 0) {
        const marker = childEvents[markerIndex];
        if (
            marker.type !== "session.info" ||
            marker.data?.infoType !== "fork"
        ) {
            throw new TypeError(
                `The fork marker is contradictory for child session ${member.sessionId}.`,
            );
        }
        if (Array.isArray(parentEvents)) {
            validateSharedPrefix(
                childEvents.slice(0, markerIndex),
                sharedParentEvents(parentEvents, member, checkpoint),
                member,
            );
        }
        return childEvents.slice(markerIndex + 1);
    }
    if (!Array.isArray(parentEvents)) {
        throw new TypeError(
            `Fork boundary unavailable for child session ${member.sessionId}.`,
        );
    }

    const sharedEvents = sharedParentEvents(parentEvents, member, checkpoint);
    validateSharedPrefix(childEvents, sharedEvents, member);
    return childEvents.slice(sharedEvents.length);
}

function sharedParentEvents(parentEvents, member, checkpoint) {
    const currentBoundaryEventId =
        member.toEventId || checkpoint?.toEventId || null;
    const parentBoundary = currentBoundaryEventId
        ? parentEvents.findIndex((event) => event.id === currentBoundaryEventId)
        : parentEvents.length;
    if (parentBoundary < 0) {
        throw new TypeError(
            `Fork checkpoint boundary is missing for child session ${member.sessionId}.`,
        );
    }
    return parentEvents.slice(0, parentBoundary);
}

function validateSharedPrefix(childEvents, sharedEvents, member) {
    if (
        sharedEvents.length > childEvents.length ||
        sharedEvents.some((event, index) => event.id !== childEvents[index]?.id)
    ) {
        throw new TypeError(
            `Fork boundary is contradictory for child session ${member.sessionId}.`,
        );
    }
}

function hasCode(error, code) {
    return Boolean(error && typeof error === "object" && error.code === code);
}

/**
 * @param {string} message
 * @param {unknown} error
 * @returns {UnavailableMap}
 */
function errorState(message, error) {
    const detail =
        error instanceof Error && error.message ? ` ${error.message}` : "";
    return {
        kind: "error",
        message: `${message}${detail}`,
    };
}
