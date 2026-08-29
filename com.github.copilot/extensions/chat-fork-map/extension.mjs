import { createCanvas, joinSession } from "@github/copilot-sdk/extension";

import { closeServer, startCanvasServer } from "./canvas-server.mjs";
import { readSessionEvents } from "./event-reader.mjs";
import {
    loadCurrentSessionMap,
    missingCanvasCapabilities,
} from "./family-service.mjs";
import { createForkService } from "./fork-service.mjs";
import { createLineageStore } from "./lineage-store.mjs";

const CANVAS_ID = "chat-fork-map";
const CURRENT_MAP_INSTANCE_ID = "chat-fork-map-current";
const servers = new Map();
/** @type {import("@github/copilot-sdk").CopilotSession | undefined} */
let session;
let forkService;
let snapshotPromise;
const lineageStore = createLineageStore();

function currentSession() {
    if (!session) {
        throw new Error("Conversation Fork Map has not joined the session.");
    }
    return session;
}

function loadSnapshot() {
    if (snapshotPromise) return snapshotPromise;
    snapshotPromise = loadCurrentSessionMap(currentSession(), {
        lineageStore,
    }).finally(() => {
        snapshotPromise = undefined;
    });
    return snapshotPromise;
}

function forkFromTurn(request) {
    if (!forkService) {
        throw new Error("Conversation Fork Map fork service is not ready.");
    }
    return forkService.forkFromTurn(request);
}

async function setSubtreeHidden(request) {
    if (
        !request ||
        typeof request !== "object" ||
        typeof request.sessionId !== "string" ||
        typeof request.hidden !== "boolean"
    ) {
        throw new TypeError(
            "Hidden subtree requests require sessionId and hidden.",
        );
    }
    const snapshot = await loadSnapshot();
    if (snapshot.kind !== "ready") {
        throw new Error(snapshot.message);
    }
    const lane = snapshot.lanes.find(
        (candidate) => candidate.session.id === request.sessionId,
    );
    if (!lane) {
        throw new TypeError(
            "The selected session is not in this Conversation Family.",
        );
    }
    if (request.hidden && (lane.session.available || lane.session.current)) {
        throw new TypeError("Only an unavailable non-current subtree can be hidden.");
    }
    await lineageStore.setSessionHidden({
        currentSessionId: snapshot.currentSessionId,
        targetSessionId: request.sessionId,
        hidden: request.hidden,
    });
    return {
        kind: "updated",
        sessionId: request.sessionId,
        hidden: request.hidden,
    };
}

const canvas = createCanvas({
    id: CANVAS_ID,
    displayName: "Conversation Fork Map",
    description:
        "Visualize a local Conversation Family and create CLI-only child sessions from completed Turn Nodes; use instance chat-fork-map-current to focus and refresh the same panel.",
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
                "Fork an available local family session from a completed Turn Node into a CLI-only child session.",
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
                        description: "The source local family session ID.",
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
                setSubtreeHidden,
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
                const missingCapabilities = missingCanvasCapabilities(
                    currentSession(),
                );
                if (missingCapabilities.length > 0) {
                    throw new Error(
                        `Conversation Fork Map requires Copilot 1.0.80+ with ${missingCapabilities.join(", ")}.`,
                    );
                }
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
