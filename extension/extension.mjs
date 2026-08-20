import { createCanvas, joinSession } from "@github/copilot-sdk/extension";

import { closeServer, startCanvasServer } from "./canvas-server.mjs";
import { readSessionEvents } from "./event-reader.mjs";
import { loadCurrentSessionMap } from "./family-service.mjs";
import { createForkService } from "./fork-service.mjs";
import { createLineageStore } from "./lineage-store.mjs";

const CANVAS_ID = "chat-fork-map";
const CURRENT_MAP_INSTANCE_ID = "chat-fork-map-current";
const servers = new Map();
/** @type {import("@github/copilot-sdk").CopilotSession | undefined} */
let session;
let forkService;

function currentSession() {
    if (!session) {
        throw new Error("Conversation Fork Map has not joined the session.");
    }
    return session;
}

async function loadSnapshot() {
    return loadCurrentSessionMap(currentSession());
}

function forkFromTurn(request) {
    if (!forkService) {
        throw new Error("Conversation Fork Map fork service is not ready.");
    }
    return forkService.forkFromTurn(request);
}

const canvas = createCanvas({
    id: CANVAS_ID,
    displayName: "Conversation Fork Map",
    description:
        "Visualize a local conversation, fork from completed Turn Nodes, and enter the child chat; use instance chat-fork-map-current to focus and refresh the same panel.",
    actions: [
        {
            name: "refresh_map",
            description:
                "Refresh the current local session and report the latest map state.",
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
    ],
    open: async (context) => {
        let entry = servers.get(context.instanceId);
        if (!entry) {
            entry = await startCanvasServer({
                loadSnapshot,
                forkFromTurn,
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
    lineageStore: createLineageStore(),
    readEvents: readSessionEvents,
});
