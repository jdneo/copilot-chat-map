/**
 * @typedef {object} SessionEvent
 * @property {string} id
 * @property {string} type
 * @property {boolean} [ephemeral]
 * @property {string} [agentId]
 * @property {{
 *   agentId?: string,
 *   parentToolCallId?: string,
 *   source?: string,
 *   content?: string,
 *   toolRequests?: unknown[]
 * }} data
 */

/**
 * @typedef {object} TurnNode
 * @property {string} id
 * @property {string} userEventId
 * @property {string | null} assistantEventId
 * @property {string | null} toEventId
 * @property {string} userContent
 * @property {string} assistantContent
 * @property {"completed" | "incomplete"} status
 * @property {unknown[]} executionDetails
 */

/**
 * @param {SessionEvent[]} events
 * @param {{ isProcessing?: boolean }} [options]
 * @returns {TurnNode[]}
 */
export function groupTurns(events, { isProcessing = false } = {}) {
    /** @type {TurnNode[]} */
    const turns = [];
    /** @type {Map<string, TurnNode>} */
    const toolOwners = new Map();
    /** @type {Map<string, TurnNode>} */
    const agentOwners = new Map();
    /** @type {TurnNode | undefined} */
    let currentTurn;
    let turnEnded = false;
    let turnAborted = false;

    for (const event of events) {
        if (event.ephemeral) {
            continue;
        }

        if (isExecutionDetail(event)) {
            const owner =
                findExecutionOwner(event, toolOwners, agentOwners) ||
                currentTurn;
            if (owner) {
                owner.executionDetails.push(event);
                rememberExecutionOwner(
                    event,
                    owner,
                    toolOwners,
                    agentOwners,
                );
            }
            continue;
        }

        if (event.type === "user.message") {
            if (event.data.source && event.data.source !== "user") {
                continue;
            }

            if (typeof event.data.content !== "string") {
                throw new TypeError(
                    `Visible user event ${event.id} has no text content.`,
                );
            }

            if (currentTurn) {
                currentTurn.toEventId = event.id;
            }

            /** @type {TurnNode} */
            const turn = {
                id: event.id,
                userEventId: event.id,
                assistantEventId: null,
                toEventId: null,
                userContent: event.data.content,
                assistantContent: "",
                status: "incomplete",
                executionDetails: [],
            };
            currentTurn = turn;
            turns.push(turn);
            turnEnded = false;
            turnAborted = false;
            continue;
        }

        if (!currentTurn) {
            continue;
        }

        if (
            event.type === "assistant.message" &&
            typeof event.data.content === "string" &&
            event.data.content.trim() &&
            (!Array.isArray(event.data.toolRequests) ||
                event.data.toolRequests.length === 0)
        ) {
            currentTurn.assistantEventId = event.id;
            currentTurn.assistantContent = event.data.content;
        } else if (event.type === "abort") {
            turnAborted = true;
            currentTurn.status = "incomplete";
        } else if (event.type === "assistant.turn_end") {
            turnEnded = true;
        }

        if (turnEnded && currentTurn.assistantEventId && !turnAborted) {
            currentTurn.status = "completed";
        }
    }

    if (isProcessing && turns.length > 0) {
        const latestTurn = turns.at(-1);
        if (latestTurn) {
            latestTurn.status = "incomplete";
        }
    }

    return turns;
}

/** @param {SessionEvent} event */
function isExecutionDetail(event) {
    return Boolean(
        event.agentId ||
        event.data?.agentId ||
        event.data?.parentToolCallId ||
        event.type.startsWith("tool.") ||
        event.type.startsWith("permission.") ||
        event.type.startsWith("subagent.") ||
        (event.type === "assistant.message" &&
            Array.isArray(event.data?.toolRequests) &&
            event.data.toolRequests.length > 0),
    );
}

/**
 * @param {SessionEvent} event
 * @param {Map<string, TurnNode>} toolOwners
 * @param {Map<string, TurnNode>} agentOwners
 */
function findExecutionOwner(event, toolOwners, agentOwners) {
    const toolCallId =
        event.data?.parentToolCallId || event.data?.toolCallId;
    const agentId = event.agentId || event.data?.agentId;
    return (
        (toolCallId && toolOwners.get(toolCallId)) ||
        (agentId && agentOwners.get(agentId))
    );
}

/**
 * @param {SessionEvent} event
 * @param {TurnNode} owner
 * @param {Map<string, TurnNode>} toolOwners
 * @param {Map<string, TurnNode>} agentOwners
 */
function rememberExecutionOwner(event, owner, toolOwners, agentOwners) {
    const toolCallIds = [
        event.data?.toolCallId,
        ...(Array.isArray(event.data?.toolRequests)
            ? event.data.toolRequests.map((request) => request?.toolCallId)
            : []),
    ];
    for (const toolCallId of toolCallIds) {
        if (typeof toolCallId === "string" && toolCallId) {
            toolOwners.set(toolCallId, owner);
        }
    }

    const agentId = event.agentId || event.data?.agentId;
    if (typeof agentId === "string" && agentId) {
        agentOwners.set(agentId, owner);
    }
}
