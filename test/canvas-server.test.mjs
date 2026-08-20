import assert from "node:assert/strict";
import test from "node:test";

import {
    closeServer,
    startCanvasServer,
} from "../extension/canvas-server.mjs";

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

test("opens an existing family session through the authenticated canvas API", async () => {
    const requests = [];
    const entry = await startCanvasServer({
        loadSnapshot: async () => ({ kind: "ready", lanes: [] }),
        forkFromTurn: async () => ({ kind: "fork_failed" }),
        openSession: async (request) => {
            requests.push(request);
            return {
                kind: "opened",
                sessionId: "22222222-2222-4222-8222-222222222222",
                navigation: "requested",
            };
        },
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
        assert.deepEqual(requests, [
            { sessionId: "22222222-2222-4222-8222-222222222222" },
        ]);
    } finally {
        await closeServer(entry.server);
    }
});

test("returns a clear manual fallback when host navigation is unavailable", async () => {
    const entry = await startCanvasServer({
        loadSnapshot: async () => ({ kind: "ready", lanes: [] }),
        forkFromTurn: async () => ({ kind: "fork_failed" }),
        openSession: async ({ sessionId }) => ({
            kind: "navigation_failed",
            sessionId,
            message:
                "Could not open this chat. Open it manually from the session list.",
        }),
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
                "Could not open this chat. Open it manually from the session list.",
        });
    } finally {
        await closeServer(entry.server);
    }
});
