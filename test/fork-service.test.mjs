import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    branchName,
    createForkService,
} from "../extension/fork-service.mjs";
import { createLineageStore } from "../extension/lineage-store.mjs";

const PARENT_ID = "11111111-1111-4111-8111-111111111111";
const CHILD_ID = "22222222-2222-4222-8222-222222222222";
const FIRST_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FIRST_ASSISTANT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NEXT_USER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

test("forks after the selected completed turn and opens the durable child", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-lineage-"),
    );
    const calls = [];
    const lineageStore = createLineageStore({
        filePath: path.join(temporaryRoot, "lineage-v1.json"),
    });
    const service = createForkService({
        session: {
            sessionId: PARENT_ID,
            rpc: {
                metadata: {
                    isProcessing: async () => ({ processing: false }),
                },
                sessions: {
                    fork: async (params) => {
                        calls.push(["fork", params]);
                        return { sessionId: CHILD_ID, name: params.name };
                    },
                },
                commands: {
                    enqueue: async (params) => {
                        calls.push(["navigate", params]);
                        return { queued: true };
                    },
                },
            },
        },
        lineageStore,
        readEvents: async (sessionId) =>
            sessionId === CHILD_ID
                ? [
                      {
                          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                          type: "session.info",
                          data: { infoType: "fork", message: "Forked session" },
                      },
                  ]
                : completedTurns(),
        now: () => new Date("2026-08-20T07:00:00.000Z"),
    });

    try {
        const result = await service.forkFromTurn({
            operationId: "operation-1",
            sessionId: PARENT_ID,
            turnId: FIRST_USER_ID,
        });

        assert.deepEqual(result, {
            kind: "created",
            childSessionId: CHILD_ID,
            name: "Explain the error · Branch 1",
            navigation: "requested",
        });
        assert.deepEqual(calls, [
            [
                "fork",
                {
                    sessionId: PARENT_ID,
                    toEventId: NEXT_USER_ID,
                    name: "Explain the error · Branch 1",
                },
            ],
            ["navigate", { command: `/resume ${CHILD_ID}` }],
        ]);

        const lineage = await lineageStore.read();
        assert.equal(lineage.revision, 1);
        assert.equal(
            lineage.families[PARENT_ID].members[CHILD_ID].toEventId,
            NEXT_USER_ID,
        );
        assert.equal(
            lineage.families[PARENT_ID].members[CHILD_ID].childForkMarkerEventId,
            "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        );
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

function completedTurns() {
    return [
        {
            id: FIRST_USER_ID,
            type: "user.message",
            data: { content: "  Explain \n the error  ", source: "user" },
        },
        {
            id: FIRST_ASSISTANT_ID,
            type: "assistant.message",
            data: { content: "The types differ." },
        },
        {
            id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            type: "assistant.turn_end",
            data: { turnId: "turn-1" },
        },
        {
            id: NEXT_USER_ID,
            type: "user.message",
            data: { content: "Fix it", source: "user" },
        },
        {
            id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
            type: "assistant.message",
            data: { content: "Done." },
        },
        {
            id: "99999999-9999-4999-8999-999999999999",
            type: "assistant.turn_end",
            data: { turnId: "turn-2" },
        },
    ];
}

test("generates normalized, truncated branch names without a model request", () => {
    assert.equal(
        branchName(" \tFix\u0007   this\nnow ", 3),
        "Fix this now · Branch 3",
    );
    assert.equal(branchName("\u0000\t\n", 2), "Untitled branch 2");
    assert.equal(
        branchName("1234567890123456789012345678901234567890123456789", 1),
        "123456789012345678901234567890123456789012345678 · Branch 1",
    );
});

test("coalesces repeated pending submissions into one child session", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-duplicate-"),
    );
    let releaseFork;
    let forkCount = 0;
    const forkGate = new Promise((resolve) => {
        releaseFork = resolve;
    });
    const service = createForkService({
        session: testSession({
            fork: async (params) => {
                forkCount += 1;
                await forkGate;
                return { sessionId: CHILD_ID, name: params.name };
            },
        }),
        lineageStore: createLineageStore({
            filePath: path.join(temporaryRoot, "lineage-v1.json"),
        }),
        readEvents: async (sessionId) =>
            sessionId === CHILD_ID ? [] : completedTurns(),
    });

    try {
        const request = defaultRequest();
        const first = service.forkFromTurn(request);
        const second = service.forkFromTurn(request);
        assert.equal(first, second);

        releaseFork();
        const [firstResult, secondResult] = await Promise.all([first, second]);

        assert.equal(firstResult.kind, "created");
        assert.deepEqual(secondResult, firstResult);
        assert.equal(forkCount, 1);
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("leaves lineage unchanged when the runtime fork fails", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-runtime-failure-"),
    );
    let navigationCount = 0;
    const lineageStore = createLineageStore({
        filePath: path.join(temporaryRoot, "lineage-v1.json"),
    });
    const service = createForkService({
        session: testSession({
            fork: async () => {
                throw new Error("Runtime unavailable");
            },
            enqueue: async () => {
                navigationCount += 1;
                return { queued: true };
            },
        }),
        lineageStore,
        readEvents: async () => completedTurns(),
    });

    try {
        const result = await service.forkFromTurn(defaultRequest());

        assert.equal(result.kind, "fork_failed");
        assert.match(result.message, /Runtime unavailable/);
        assert.deepEqual(await lineageStore.read(), {
            version: 1,
            revision: 0,
            families: {},
            sessionToFamily: {},
        });
        assert.equal(navigationCount, 0);
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("reports the child and does not navigate when lineage persistence fails", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-lineage-failure-"),
    );
    const filePath = path.join(temporaryRoot, "lineage-v1.json");
    let navigationCount = 0;
    const service = createForkService({
        session: testSession({
            fork: async (params) => {
                await mkdir(filePath);
                return { sessionId: CHILD_ID, name: params.name };
            },
            enqueue: async () => {
                navigationCount += 1;
                return { queued: true };
            },
        }),
        lineageStore: createLineageStore({ filePath }),
        readEvents: async (sessionId) =>
            sessionId === CHILD_ID ? [] : completedTurns(),
    });

    try {
        const result = await service.forkFromTurn(defaultRequest());

        assert.equal(result.kind, "lineage_failed");
        assert.equal(result.childSessionId, CHILD_ID);
        assert.match(result.message, /do not retry this fork/i);
        assert.equal(navigationCount, 0);
        assert.equal((await stat(filePath)).isDirectory(), true);
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("preserves durable lineage and reuses the result when navigation fails", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-navigation-failure-"),
    );
    let forkCount = 0;
    const lineageStore = createLineageStore({
        filePath: path.join(temporaryRoot, "lineage-v1.json"),
    });
    const service = createForkService({
        session: testSession({
            fork: async (params) => {
                forkCount += 1;
                return { sessionId: CHILD_ID, name: params.name };
            },
            enqueue: async () => {
                throw new Error("Host navigation unavailable");
            },
        }),
        lineageStore,
        readEvents: async (sessionId) =>
            sessionId === CHILD_ID ? [] : completedTurns(),
    });

    try {
        const first = await service.forkFromTurn(defaultRequest());
        const repeated = await service.forkFromTurn(defaultRequest());

        assert.equal(first.kind, "navigation_failed");
        assert.equal(first.childSessionId, CHILD_ID);
        assert.match(first.message, /Open it manually/);
        assert.deepEqual(repeated, first);
        assert.equal(forkCount, 1);
        assert.equal((await lineageStore.read()).revision, 1);
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("forks the final completed turn when the child marker is not yet readable", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-final-turn-"),
    );
    let forkParams;
    const lineageStore = createLineageStore({
        filePath: path.join(temporaryRoot, "lineage-v1.json"),
    });
    const finalTurnEvents = completedTurns().slice(3);
    const service = createForkService({
        session: testSession({
            fork: async (params) => {
                forkParams = params;
                return { sessionId: CHILD_ID, name: params.name };
            },
        }),
        lineageStore,
        readEvents: async (sessionId) => {
            if (sessionId === CHILD_ID) {
                throw Object.assign(new Error("Not written yet"), {
                    code: "ENOENT",
                });
            }
            return finalTurnEvents;
        },
    });

    try {
        const result = await service.forkFromTurn({
            operationId: "final-turn",
            sessionId: PARENT_ID,
            turnId: NEXT_USER_ID,
        });

        assert.equal(result.kind, "created");
        assert.deepEqual(forkParams, {
            sessionId: PARENT_ID,
            name: "Fix it · Branch 1",
        });
        assert.equal(
            (await lineageStore.read()).families[PARENT_ID].members[CHILD_ID]
                .childForkMarkerEventId,
            null,
        );
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("assigns deterministic sibling ordinals at one checkpoint", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-siblings-"),
    );
    const childIds = [
        CHILD_ID,
        "33333333-3333-4333-8333-333333333333",
    ];
    const names = [];
    const lineageStore = createLineageStore({
        filePath: path.join(temporaryRoot, "lineage-v1.json"),
    });
    const service = createForkService({
        session: testSession({
            fork: async (params) => {
                names.push(params.name);
                return { sessionId: childIds.shift(), name: params.name };
            },
        }),
        lineageStore,
        readEvents: async (sessionId) =>
            sessionId === PARENT_ID ? completedTurns() : [],
    });

    try {
        await service.forkFromTurn(defaultRequest());
        await service.forkFromTurn({
            ...defaultRequest(),
            operationId: "operation-2",
        });

        assert.deepEqual(names, [
            "Explain the error · Branch 1",
            "Explain the error · Branch 2",
        ]);
        assert.equal((await lineageStore.read()).revision, 2);
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("rejects every checkpoint while the foreground agent is active", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-processing-"),
    );
    let forkCount = 0;
    const lineageStore = createLineageStore({
        filePath: path.join(temporaryRoot, "lineage-v1.json"),
    });
    const service = createForkService({
        session: testSession({
            processing: true,
            fork: async () => {
                forkCount += 1;
                return { sessionId: CHILD_ID };
            },
        }),
        lineageStore,
        readEvents: async () => completedTurns(),
    });

    try {
        const result = await service.forkFromTurn(defaultRequest());

        assert.equal(result.kind, "fork_failed");
        assert.match(result.message, /active agent turn/);
        assert.equal(forkCount, 0);
        assert.equal((await lineageStore.read()).revision, 0);
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("rejects occupied and unavailable non-current source lanes", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-source-state-"),
    );
    const lineageStore = createLineageStore({
        filePath: path.join(temporaryRoot, "lineage-v1.json"),
    });
    await lineageStore.recordFork({
        parentSessionId: PARENT_ID,
        childSessionId: CHILD_ID,
        sourceUserEventId: FIRST_USER_ID,
        sourceAssistantEventId: FIRST_ASSISTANT_ID,
        toEventId: NEXT_USER_ID,
        childForkMarkerEventId: null,
        siblingOrdinal: 1,
        createdAt: "2026-08-21T01:00:00.000Z",
    });
    let sourceAvailable = true;
    let sourceOccupied = true;
    let forkCount = 0;
    const service = createForkService({
        session: testSession({
            fork: async () => {
                forkCount += 1;
                return { sessionId: "33333333-3333-4333-8333-333333333333" };
            },
        }),
        lineageStore,
        readEvents: async () => completedTurns(),
        listSessions: async () =>
            sourceAvailable
                ? [{ sessionId: CHILD_ID, isRemote: false }]
                : [],
        checkInUse: async () =>
            sourceOccupied ? new Set([CHILD_ID]) : new Set(),
    });

    try {
        const occupied = await service.forkFromTurn({
            operationId: "occupied-source",
            sessionId: CHILD_ID,
            turnId: FIRST_USER_ID,
        });
        sourceOccupied = false;
        sourceAvailable = false;
        const unavailable = await service.forkFromTurn({
            operationId: "unavailable-source",
            sessionId: CHILD_ID,
            turnId: FIRST_USER_ID,
        });

        assert.equal(occupied.kind, "fork_failed");
        assert.match(occupied.message, /occupied/);
        assert.equal(unavailable.kind, "fork_failed");
        assert.match(unavailable.message, /unavailable/);
        assert.equal(forkCount, 0);
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("forks through the server request exposed by a 1.0.80 joined session", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-server-rpc-"),
    );
    const calls = [];
    const session = testSession({
        fork: async () => {
            throw new Error("Session-scoped fork should not be used.");
        },
    });
    delete session.rpc.sessions;
    session.connection = {
        sendRequest: async (method, params) => {
            calls.push([method, params]);
            return { sessionId: CHILD_ID, name: params.name };
        },
    };
    const service = createForkService({
        session,
        lineageStore: createLineageStore({
            filePath: path.join(temporaryRoot, "lineage-v1.json"),
        }),
        readEvents: async (sessionId) =>
            sessionId === CHILD_ID ? [] : completedTurns(),
    });

    try {
        const result = await service.forkFromTurn(defaultRequest());

        assert.equal(result.kind, "created");
        assert.deepEqual(calls, [
            [
                "sessions.fork",
                {
                    sessionId: PARENT_ID,
                    toEventId: NEXT_USER_ID,
                    name: "Explain the error · Branch 1",
                },
            ],
        ]);
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

function defaultRequest() {
    return {
        operationId: "operation-1",
        sessionId: PARENT_ID,
        turnId: FIRST_USER_ID,
    };
}

function testSession({
    fork,
    enqueue = async () => ({ queued: true }),
    processing = false,
}) {
    return {
        sessionId: PARENT_ID,
        rpc: {
            metadata: {
                isProcessing: async () => ({ processing }),
            },
            sessions: { fork },
            commands: { enqueue },
        },
    };
}
