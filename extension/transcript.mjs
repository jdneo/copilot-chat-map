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
    /** @type {TurnNode | undefined} */
    let currentTurn;
    let turnEnded = false;

    for (const event of events) {
        if (
            event.ephemeral ||
            event.agentId ||
            event.data?.agentId ||
            event.data?.parentToolCallId
        ) {
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

            /** @type {TurnNode} */
            const turn = {
                id: event.id,
                userEventId: event.id,
                assistantEventId: null,
                userContent: event.data.content,
                assistantContent: "",
                status: "incomplete",
                executionDetails: [],
            };
            currentTurn = turn;
            turns.push(turn);
            turnEnded = false;
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
        } else if (event.type === "assistant.turn_end") {
            turnEnded = true;
        }

        if (turnEnded && currentTurn.assistantEventId) {
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
