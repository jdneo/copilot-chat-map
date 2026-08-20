import { readSessionEvents } from "./event-reader.mjs";
import { groupTurns } from "./transcript.mjs";

/** @typedef {import("@github/copilot-sdk").CopilotSession} JoinedSession */

/**
 * @typedef {{
 *   id: string,
 *   userEventId: string,
 *   assistantEventId: string | null,
 *   userContent: string,
 *   assistantContent: string,
 *   status: "completed" | "incomplete",
 *   executionDetails: unknown[]
 * }} TurnNode
 */

/**
 * @typedef {{
 *   kind: "ready",
 *   readOnly: true,
 *   session: { id: string, title: string },
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
        "commands.enqueue",
        (session) => typeof session.rpc.commands?.enqueue === "function",
    ],
];

/**
 * @param {JoinedSession} session
 * @returns {Promise<CurrentSessionMap>}
 */
export async function loadCurrentSessionMap(session) {
    const missingCapabilities = REQUIRED_CAPABILITIES.filter(
        ([, isAvailable]) => !isAvailable(session),
    ).map(([name]) => name);

    if (missingCapabilities.length > 0) {
        return {
            kind: "unsupported",
            message: `Conversation Fork Map requires Copilot 1.0.80+ with ${missingCapabilities.join(", ")}.`,
        };
    }

    let metadata;
    let name;
    let activity;
    try {
        [metadata, name, activity] = await Promise.all([
            session.rpc.metadata.snapshot(),
            session.rpc.name.get(),
            session.rpc.metadata.isProcessing(),
        ]);
    } catch (error) {
        return errorState("Could not inspect the current Copilot session.", error);
    }

    if (metadata.isRemote) {
        return {
            kind: "unsupported",
            message:
                "Conversation Fork Map supports local Copilot sessions only.",
        };
    }

    try {
        const events = await readSessionEvents(session.sessionId);
        const turns = groupTurns(events, {
            isProcessing: activity.processing,
        });
        return {
            kind: "ready",
            readOnly: true,
            session: {
                id: session.sessionId,
                title:
                    name.name ||
                    metadata.initialName ||
                    metadata.summary ||
                    "Current Copilot session",
            },
            turns,
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
