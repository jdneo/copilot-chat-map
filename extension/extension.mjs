import { createCanvas, joinSession } from "@github/copilot-sdk/extension";

import { closeServer, startCanvasServer } from "./canvas-server.mjs";
import { isValidLocalSessionId, readSessionEvents } from "./event-reader.mjs";
import { loadCurrentSessionMap } from "./family-service.mjs";
import { createForkService } from "./fork-service.mjs";
import { createLineageStore } from "./lineage-store.mjs";
import { navigateToSession } from "./runtime.mjs";

const CANVAS_ID = "chat-fork-map";
const CURRENT_MAP_INSTANCE_ID = "chat-fork-map-current";
const servers = new Map();
/** @type {import("@github/copilot-sdk").CopilotSession | undefined} */
let session;
let forkService;
const lineageStore = createLineageStore();

function currentSession() {
    if (!session) {
        throw new Error("Conversation Fork Map has not joined the session.");
    }
    return session;
}

async function loadSnapshot() {
    return loadCurrentSessionMap(currentSession(), { lineageStore });
}

function forkFromTurn(request) {
    if (!forkService) {
        throw new Error("Conversation Fork Map fork service is not ready.");
    }

    async function openSession(request) {
        const sessionId = request?.sessionId;
        if (!isValidLocalSessionId(sessionId)) {
            return {
                kind: "unavailable",
                message: "Open Chat requires a valid local session ID.",
            };
        }

        const snapshot = await loadSnapshot();
        if (snapshot.kind !== "ready") {
            return {
                kind: "unavailable",
                message: snapshot.message,
            };
        }
        const lane = snapshot.lanes.find(
            (candidate) => candidate.session.id === sessionId,
        );
        if (!lane?.session.available) {
            return {
                kind: "unavailable",
                sessionId,
                message: "This family session is no longer available locally.",
            };
        }
        if (lane.session.current) {
            return {
                kind: "opened",
                sessionId,
                navigation: "already_current",
            };
        }

        try {
            await navigateToSession(currentSession(), sessionId);
            return { kind: "opened", sessionId, navigation: "requested" };
        } catch (error) {
            const detail = error instanceof Error ? ` ${error.message}` : "";
            return {
                kind: "navigation_failed",
                sessionId,
                message: `Could not open this chat.${detail} Open it manually from the session list.`,
            };
        }
    }
    return forkService.forkFromTurn(request);
}

const canvas = createCanvas({
    id: CANVAS_ID,
    displayName: "Conversation Fork Map",
    description:
        "Visualize a local Conversation Family, fork from completed Turn Nodes, and open any available session; use instance chat-fork-map-current to focus and refresh the same panel.",
    actions: [
        {
            name: "refresh_map",
            description:
                "Refresh the local Conversation Family and report its latest map state.",
            handler: async () => {
                const snapshot = await loadSnapshot();
                return snapshot.kind === "ready"
                    ? {
                          status: "ready",
                          turnCount: snapshot.turns.length,
                          updatedAt: snapshot.updatedAt,
                      }
                    : {
                          status: snapshot.kind,
                          message: snapshot.message,
                      };
            },
        },
        {
            name: "fork_from_turn",
            description:
                "Fork the current local session from a completed Turn Node and enter its child chat.",
            inputSchema: {
                type: "object",
                additionalProperties: false,
                required: ["operationId", "sessionId", "turnId"],
                properties: {
                    operationId: {
                        type: "string",
                        description:
                            "A stable unique ID reused for retries of this exact submission.",
                    },
                    sessionId: {
                        type: "string",
                        description: "The current local session ID.",
                    },
                    turnId: {
                        type: "string",
                        description:
                            "The user event ID of the completed Turn Node.",
                    },
                },
            },
            handler: async (context) => forkFromTurn(context.input),
        },
        {
            name: "open_branch",
            description: "Open an existing available family session in Chat View.",
            inputSchema: {
                type: "object",
                additionalProperties: false,
                required: ["sessionId"],
                properties: {
                    sessionId: {
                        type: "string",
                        description: "The local family session ID to open.",
                    },
                },
            },
            handler: async (context) => openSession(context.input),
        },
    ],
    open: async (context) => {
        let entry = servers.get(context.instanceId);
        if (!entry) {
            entry = await startCanvasServer({
                loadSnapshot,
                forkFromTurn,
                openSession,
            });
            servers.set(context.instanceId, entry);
        }

        const snapshot = await loadSnapshot();
        const turnCount =
            snapshot.kind === "ready" ? snapshot.turns.length : 0;
        return {
            title: "Conversation Fork Map",
            status:
                snapshot.kind === "ready"
                    ? `${turnCount} ${turnCount === 1 ? "turn" : "turns"} - Select a completed turn to branch`
                    : snapshot.message,
            url: entry.url,
        };
    },
    onClose: async (context) => {
        const entry = servers.get(context.instanceId);
        if (!entry) return;
        servers.delete(context.instanceId);
        await closeServer(entry.server);
    },
});

session = await joinSession({
    canvases: [canvas],
    commands: [
        {
            name: "fork-map",
            description: "Open the Conversation Fork Map for this session",
            handler: async () => {
                await currentSession().rpc.canvas.open({
                    canvasId: CANVAS_ID,
                    instanceId: CURRENT_MAP_INSTANCE_ID,
                });
            },
        },
    ],
});

forkService = createForkService({
    session,
    lineageStore,
    readEvents: readSessionEvents,
});
