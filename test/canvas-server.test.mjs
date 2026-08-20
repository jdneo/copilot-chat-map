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
