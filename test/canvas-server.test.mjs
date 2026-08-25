import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    closeServer,
    startCanvasServer,
} from "../extension/canvas-server.mjs";
import { createForkService } from "../extension/fork-service.mjs";
import { createLineageStore } from "../extension/lineage-store.mjs";
import { createOpenSessionService } from "../extension/navigation-service.mjs";

test("binds to loopback with a high-entropy instance token and strict CSP", async () => {
    const entry = await startCanvasServer({
        loadSnapshot: async () => ({ kind: "ready", lanes: [] }),
        forkFromTurn: async () => ({ kind: "fork_failed" }),
        openSession: async () => ({ kind: "unavailable" }),
    });

    try {
        const address = entry.server.address();
        assert.ok(address && typeof address === "object");
        assert.equal(address.address, "127.0.0.1");

        const url = new URL(entry.url);
        assert.match(url.searchParams.get("token"), /^[0-9a-f]{64}$/);
        const response = await fetch(url);
        assert.equal(response.status, 200);
        assert.equal(
            response.headers.get("content-security-policy"),
            [
                "default-src 'none'",
                "script-src 'unsafe-inline'",
                "style-src 'unsafe-inline'",
                "connect-src 'self'",
                "img-src https:",
                "base-uri 'none'",
                "form-action 'none'",
            ].join("; "),
        );
        assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    } finally {
        await closeServer(entry.server);
    }
});

test("requires the instance token before invoking any canvas handler", async () => {
    let handlerCalls = 0;
    const entry = await startCanvasServer({
        loadSnapshot: async () => {
            handlerCalls += 1;
            return { kind: "ready", lanes: [] };
        },
        forkFromTurn: async () => {
            handlerCalls += 1;
            return { kind: "fork_failed" };
        },
        openSession: async () => {
            handlerCalls += 1;
            return { kind: "unavailable" };
        },
    });

    try {
        const url = new URL(entry.url);
        url.pathname = "/api/state";
        url.search = "";
        const response = await fetch(url);

        assert.equal(response.status, 403);
        assert.equal(handlerCalls, 0);
    } finally {
        await closeServer(entry.server);
    }
});

test("rejects mutation bodies above the fixed request limit", async () => {
    const entry = await startCanvasServer({
        loadSnapshot: async () => ({ kind: "ready", lanes: [] }),
        forkFromTurn: async () => ({ kind: "fork_failed" }),
        openSession: async () => ({ kind: "unavailable" }),
    });

    try {
        const url = new URL(entry.url);
        url.pathname = "/api/fork";
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payload: "x".repeat(4_096) }),
        });

        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), {
            kind: "error",
            message: "Fork request exceeds 4096 bytes.",
        });
    } finally {
        await closeServer(entry.server);
    }
});

test("rejects non-POST mutation requests with an explicit method contract", async () => {
    const entry = await startCanvasServer({
        loadSnapshot: async () => ({ kind: "ready", lanes: [] }),
        forkFromTurn: async () => ({ kind: "fork_failed" }),
        openSession: async () => ({ kind: "unavailable" }),
        setSubtreeHidden: async () => ({ kind: "updated" }),
    });

    try {
        for (const pathname of [
            "/api/fork",
            "/api/open-session",
            "/api/hidden-subtree",
        ]) {
            const url = new URL(entry.url);
            url.pathname = pathname;
            const response = await fetch(url);

            assert.equal(response.status, 405);
            assert.equal(response.headers.get("allow"), "POST");
        }
    } finally {
        await closeServer(entry.server);
    }
});

test("creates a child through the authenticated canvas API", async () => {
    const requests = [];
    const entry = await startCanvasServer({
        loadSnapshot: async () => ({
            kind: "ready",
            canFork: true,
            session: { id: "11111111-1111-4111-8111-111111111111" },
            turns: [],
        }),
        forkFromTurn: async (request) => {
            requests.push(request);
            return {
                kind: "created",
                childSessionId: "22222222-2222-4222-8222-222222222222",
                name: "Explain the error · Branch 1",
                navigation: "requested",
            };
        },
        openSession: async () => {
            throw new Error("Open Chat should not be called by the fork route.");
        },
    });

    try {
        const url = new URL(entry.url);
        url.pathname = "/api/fork";
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                operationId: "operation-1",
                sessionId: "11111111-1111-4111-8111-111111111111",
                turnId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            }),
        });

        assert.equal(response.status, 201);
        assert.deepEqual(await response.json(), {
            kind: "created",
            childSessionId: "22222222-2222-4222-8222-222222222222",
            name: "Explain the error · Branch 1",
            navigation: "requested",
        });
        assert.deepEqual(requests, [
            {
                operationId: "operation-1",
                sessionId: "11111111-1111-4111-8111-111111111111",
                turnId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            },
        ]);
    } finally {
        await closeServer(entry.server);
    }
});

test("creates a nested child from a non-current family lane through the canvas API", async () => {
    const rootId = "11111111-1111-4111-8111-111111111111";
    const childId = "22222222-2222-4222-8222-222222222222";
    const grandchildId = "33333333-3333-4333-8333-333333333333";
    const childTurnId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-non-current-api-"),
    );
    const lineageStore = createLineageStore({
        filePath: path.join(temporaryRoot, "lineage-v1.json"),
    });
    await lineageStore.recordFork({
        parentSessionId: rootId,
        childSessionId: childId,
        sourceUserEventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        sourceAssistantEventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        toEventId: null,
        childForkMarkerEventId: null,
        siblingOrdinal: 1,
        createdAt: "2026-08-21T01:00:00.000Z",
    });
    const forkCalls = [];
    const service = createForkService({
        session: {
            sessionId: rootId,
            rpc: {
                metadata: {
                    isProcessing: async () => ({ processing: false }),
                },
                sessions: {
                    fork: async (params) => {
                        forkCalls.push(params);
                        return { sessionId: grandchildId, name: params.name };
                    },
                },
                commands: {
                    enqueue: async () => ({ queued: true }),
                },
            },
        },
        lineageStore,
        readEvents: async (sessionId) =>
            sessionId === childId
                ? [
                      {
                          id: childTurnId,
                          type: "user.message",
                          data: { content: "Continue here", source: "user" },
                      },
                      {
                          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                          type: "assistant.message",
                          data: { content: "Ready." },
                      },
                      {
                          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                          type: "assistant.turn_end",
                          data: {},
                      },
                  ]
                : [],
        listSessions: async () => [
            { sessionId: rootId, isRemote: false },
            { sessionId: childId, isRemote: false },
        ],
        checkInUse: async () => new Set(),
        now: () => new Date("2026-08-21T02:00:00.000Z"),
    });
    const entry = await startCanvasServer({
        loadSnapshot: async () => ({ kind: "ready", lanes: [] }),
        forkFromTurn: service.forkFromTurn,
        openSession: async () => ({ kind: "unavailable" }),
    });

    try {
        const url = new URL(entry.url);
        url.pathname = "/api/fork";
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                operationId: "nested-operation",
                sessionId: childId,
                turnId: childTurnId,
            }),
        });

        assert.equal(response.status, 201);
        assert.deepEqual(forkCalls, [
            {
                sessionId: childId,
                name: "Continue here · Branch 1",
            },
        ]);
        const lineage = await lineageStore.read();
        assert.equal(
            lineage.families[rootId].members[grandchildId].parentSessionId,
            childId,
        );
    } finally {
        await closeServer(entry.server);
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("opens an existing family session through the authenticated canvas API", async () => {
    const commands = [];
    const service = createOpenSessionService({
        getSession: () => ({
            rpc: {
                commands: {
                    execute: async () => {
                        throw new Error("Open Chat must use queued navigation.");
                    },
                    enqueue: async (params) => {
                        commands.push(params);
                        return { queued: true };
                    },
                },
            },
        }),
        loadSnapshot: async () => navigationSnapshot(),
    });
    const entry = await startCanvasServer({
        loadSnapshot: async () => ({ kind: "ready", lanes: [] }),
        forkFromTurn: async () => ({ kind: "fork_failed" }),
        openSession: service.openSession,
    });

    try {
        const url = new URL(entry.url);
        url.pathname = "/api/open-session";
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sessionId: "22222222-2222-4222-8222-222222222222",
            }),
        });

        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            kind: "opened",
            sessionId: "22222222-2222-4222-8222-222222222222",
            navigation: "requested",
        });
        assert.deepEqual(commands, [
            {
                command:
                    "/resume 22222222-2222-4222-8222-222222222222",
            },
        ]);
    } finally {
        await closeServer(entry.server);
    }
});

test("explains the Copilot App navigation limitation", async () => {
    const service = createOpenSessionService({
        getSession: () => ({
            rpc: {
                commands: {
                    enqueue: async () => {
                        throw new Error(
                            "No client found for command: resume",
                        );
                    },
                },
            },
        }),
        loadSnapshot: async () => navigationSnapshot(),
    });
    const result = await service.openSession({
        sessionId: "22222222-2222-4222-8222-222222222222",
    });

    assert.equal(result.kind, "navigation_failed");
    assert.match(
        result.message,
        /automatic Chat View switching is not supported/i,
    );
    assert.doesNotMatch(result.message, /no client found/i);
});

test("surfaces a synchronous host navigation error", async () => {
    const service = createOpenSessionService({
        getSession: () => ({
            rpc: {
                commands: {
                    enqueue: async () => {
                        throw new Error(
                            "The host could not resume this session.",
                        );
                    },
                },
            },
        }),
        loadSnapshot: async () => navigationSnapshot(),
    });
    const entry = await startCanvasServer({
        loadSnapshot: async () => ({ kind: "ready", lanes: [] }),
        forkFromTurn: async () => ({ kind: "fork_failed" }),
        openSession: service.openSession,
    });

    try {
        const url = new URL(entry.url);
        url.pathname = "/api/open-session";
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sessionId: "22222222-2222-4222-8222-222222222222",
            }),
        });

        assert.equal(response.status, 502);
        const result = await response.json();
        assert.match(
            result.message,
            /host could not resume this session/i,
        );
        assert.match(
            result.message,
            /\/resume 22222222-2222-4222-8222-222222222222/,
        );
    } finally {
        await closeServer(entry.server);
    }
});

test("returns a clear manual fallback when host navigation is unavailable", async () => {
    const service = createOpenSessionService({
        getSession: () => ({ rpc: {} }),
        loadSnapshot: async () => navigationSnapshot(),
    });
    const entry = await startCanvasServer({
        loadSnapshot: async () => ({ kind: "ready", lanes: [] }),
        forkFromTurn: async () => ({ kind: "fork_failed" }),
        openSession: service.openSession,
    });

    try {
        const url = new URL(entry.url);
        url.pathname = "/api/open-session";
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sessionId: "22222222-2222-4222-8222-222222222222",
            }),
        });

        assert.equal(response.status, 502);
        assert.deepEqual(await response.json(), {
            kind: "navigation_failed",
            sessionId: "22222222-2222-4222-8222-222222222222",
            message:
                "Could not open this chat. Host navigation is unavailable. Run /resume 22222222-2222-4222-8222-222222222222 in Chat to open it.",
        });
    } finally {
        await closeServer(entry.server);
    }
});

test("falls back when the host rejects a session switch request", async () => {
    const service = createOpenSessionService({
        getSession: () => ({
            rpc: {
                commands: {
                    enqueue: async () => ({ queued: false }),
                },
            },
        }),
        loadSnapshot: async () => navigationSnapshot(),
    });
    const entry = await startCanvasServer({
        loadSnapshot: async () => ({ kind: "ready", lanes: [] }),
        forkFromTurn: async () => ({ kind: "fork_failed" }),
        openSession: service.openSession,
    });

    try {
        const url = new URL(entry.url);
        url.pathname = "/api/open-session";
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sessionId: "22222222-2222-4222-8222-222222222222",
            }),
        });

        assert.equal(response.status, 502);
        assert.match(
            (await response.json()).message,
            /host did not accept the session switch request/i,
        );
    } finally {
        await closeServer(entry.server);
    }
});

test("updates hidden subtree state through the authenticated canvas API", async () => {
    const requests = [];
    const entry = await startCanvasServer({
        loadSnapshot: async () => ({ kind: "ready", lanes: [] }),
        forkFromTurn: async () => ({ kind: "fork_failed" }),
        openSession: async () => ({ kind: "unavailable" }),
        setSubtreeHidden: async (request) => {
            requests.push(request);
            return { kind: "updated", ...request };
        },
    });

    try {
        const url = new URL(entry.url);
        url.pathname = "/api/hidden-subtree";
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sessionId: "22222222-2222-4222-8222-222222222222",
                hidden: true,
            }),
        });

        assert.equal(response.status, 200);
        assert.deepEqual(requests, [
            {
                sessionId: "22222222-2222-4222-8222-222222222222",
                hidden: true,
            },
        ]);
    } finally {
        await closeServer(entry.server);
    }
});

test("pushes live invalidation events over SSE", async () => {
    let invalidate;
    const entry = await startCanvasServer({
        loadSnapshot: async () => ({ kind: "ready", lanes: [] }),
        forkFromTurn: async () => ({ kind: "fork_failed" }),
        openSession: async () => ({ kind: "unavailable" }),
        createLiveSync: ({ onInvalidate }) => {
            invalidate = onInvalidate;
            return { update() {}, close() {} };
        },
    });
    const controller = new AbortController();

    try {
        const url = new URL(entry.url);
        url.pathname = "/api/events";
        const response = await fetch(url, { signal: controller.signal });
        const reader = response.body.getReader();
        await reader.read();
        invalidate("events");
        const message = new TextDecoder().decode((await reader.read()).value);
        assert.match(message, /event: invalidate/);
        assert.match(message, /"reason":"events"/);
        await reader.cancel();
    } finally {
        controller.abort();
        await closeServer(entry.server);
    }
});

function navigationSnapshot() {
    return {
        kind: "ready",
        lanes: [
            {
                session: {
                    id: "11111111-1111-4111-8111-111111111111",
                    current: true,
                    available: true,
                },
            },
            {
                session: {
                    id: "22222222-2222-4222-8222-222222222222",
                    current: false,
                    available: true,
                },
            },
        ],
    };
}
