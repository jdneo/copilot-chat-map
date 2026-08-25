import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

let registeredCanvas;

export function createCanvas(definition) {
    registeredCanvas = definition;
    return definition;
}

export async function joinSession(configuration) {
    const sessionId = process.env.TEST_SESSION_ID;
    const sessionIds = JSON.parse(process.env.TEST_FAMILY_SESSION_IDS || "[]");
    const navigationRequests = [];
    const canvasRendererAvailable =
        process.env.TEST_CANVAS_RENDERER !== "missing";
    const canvasOpenAvailable = process.env.TEST_CANVAS_OPEN !== "missing";
    const session = {
        sessionId,
        capabilities: { ui: { canvases: canvasRendererAvailable } },
        rpc: {
            metadata: {
                snapshot: async () => ({
                    isRemote: false,
                    initialName: `Session ${sessionId}`,
                    summary: `Summary ${sessionId}`,
                    modifiedTime: "2026-08-25T00:00:00.000Z",
                }),
                isProcessing: async () => ({ processing: false }),
            },
            name: {
                get: async () => ({ name: `Session ${sessionId}` }),
            },
            commands: {
                enqueue: async (request) => {
                    navigationRequests.push(request);
                    return { queued: true };
                },
            },
            sessions: {
                fork: async (request) => forkSession(request),
                list: async () => ({
                    sessions: sessionIds.map((id) => ({
                        sessionId: id,
                        name: `Session ${id}`,
                        summary: `Summary ${id}`,
                        modifiedTime: "2026-08-25T00:00:00.000Z",
                        isRemote: false,
                    })),
                }),
                checkInUse: async () => ({ inUse: [sessionId] }),
            },
        },
    };
    if (canvasOpenAvailable) {
        session.rpc.canvas = {
            open: async (request) => {
                const opened = await registeredCanvas.open({
                    instanceId: request.instanceId,
                });
                const stateUrl = new URL(opened.url);
                stateUrl.pathname = "/api/state";
                const state = await (await fetch(stateUrl)).json();
                let forkResult;
                let stateAfterFork;
                if (process.env.TEST_SCENARIO === "fork") {
                    const forkUrl = new URL(opened.url);
                    forkUrl.pathname = "/api/fork";
                    const response = await fetch(forkUrl, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            operationId: "provider-first-fork",
                            sessionId,
                            turnId: state.turns[0].id,
                        }),
                    });
                    forkResult = await response.json();
                    stateAfterFork = await (await fetch(stateUrl)).json();
                }
                await registeredCanvas.onClose({
                    instanceId: request.instanceId,
                });
                await writeFile(
                    process.env.TEST_CAPTURE_PATH,
                    JSON.stringify({
                        canvas: {
                            id: registeredCanvas.id,
                            displayName: registeredCanvas.displayName,
                            actionNames: registeredCanvas.actions.map(
                                (action) => action.name,
                            ),
                        },
                        openRequest: request,
                        opened,
                        state,
                        forkResult,
                        stateAfterFork,
                        navigationRequests,
                    }),
                    "utf8",
                );
            },
        };
    }

    setTimeout(async () => {
        try {
            const command = configuration.commands.find(
                (candidate) => candidate.name === "fork-map",
            );
            await command.handler();
            process.exitCode = 0;
        } catch (error) {
            await writeFile(
                process.env.TEST_CAPTURE_PATH,
                JSON.stringify({
                    error: error instanceof Error ? error.stack : String(error),
                }),
                "utf8",
            );
            process.exitCode = 1;
        }
    }, 0);

    return session;

    async function forkSession(request) {
        if (process.env.TEST_SCENARIO !== "fork") {
            throw new Error("The provider smoke test must not fork.");
        }
        const childSessionId = process.env.TEST_CHILD_SESSION_ID;
        const sessionStateRoot = path.join(
            process.env.COPILOT_HOME,
            "session-state",
        );
        const parentEvents = await readFile(
            path.join(sessionStateRoot, request.sessionId, "events.jsonl"),
            "utf8",
        );
        const childDirectory = path.join(sessionStateRoot, childSessionId);
        await mkdir(childDirectory, { recursive: true });
        await writeFile(
            path.join(childDirectory, "events.jsonl"),
            `${parentEvents}${JSON.stringify({
                id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                type: "session.info",
                data: {
                    infoType: "fork",
                    message: "Forked session",
                },
            })}\n`,
            "utf8",
        );
        return { sessionId: childSessionId, name: request.name };
    }
}
