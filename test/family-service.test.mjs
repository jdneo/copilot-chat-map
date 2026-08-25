import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadCurrentSessionMap } from "../extension/family-service.mjs";
import { createLineageStore } from "../extension/lineage-store.mjs";

const PARENT_ID = "11111111-1111-4111-8111-111111111111";
const CHILD_ID = "22222222-2222-4222-8222-222222222222";
const SIBLING_ID = "33333333-3333-4333-8333-333333333333";
const GRANDCHILD_ID = "44444444-4444-4444-8444-444444444444";
const LATE_SIBLING_ID = "45454545-4545-4545-8545-454545454545";
const SOURCE_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOURCE_ASSISTANT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CHILD_MARKER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

test("reopens a two-session Conversation Family from its parent", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-family-parent-"),
    );
    const lineageStore = createLineageStore({
        filePath: path.join(temporaryRoot, "lineage-v1.json"),
    });
    await lineageStore.recordFork(forkRecord());

    try {
        const state = await loadCurrentSessionMap(testSession(PARENT_ID), {
            lineageStore,
            readEvents: async (sessionId) =>
                sessionId === PARENT_ID ? parentEvents() : childEvents(),
            listSessions: async () => sessionMetadata(),
            checkInUse: async () => new Set([PARENT_ID]),
        });

        assert.equal(state.kind, "ready", state.message);
        assert.equal(state.family.rootSessionId, PARENT_ID);
        assert.equal(state.currentSessionId, PARENT_ID);
        assert.deepEqual(
            state.lanes.map((lane) => ({
                id: lane.session.id,
                current: lane.session.current,
                inheritedTurnCount: lane.inheritedTurnCount,
                turns: lane.turns.map((turn) => turn.userContent),
            })),
            [
                {
                    id: PARENT_ID,
                    current: true,
                    inheritedTurnCount: 0,
                    turns: ["Shared prompt", "Parent-only prompt"],
                },
                {
                    id: CHILD_ID,
                    current: false,
                    inheritedTurnCount: 1,
                    turns: ["Child-only prompt"],
                },
            ],
        );
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("reopens the same Conversation Family from its child and focuses it", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-family-child-"),
    );
    const lineageStore = createLineageStore({
        filePath: path.join(temporaryRoot, "lineage-v1.json"),
    });
    await lineageStore.recordFork(forkRecord());

    try {
        const state = await loadCurrentSessionMap(testSession(CHILD_ID), {
            lineageStore,
            readEvents: async (sessionId) =>
                sessionId === PARENT_ID ? parentEvents() : childEvents(),
            listSessions: async () => sessionMetadata(),
            checkInUse: async () => new Set([CHILD_ID]),
        });

        assert.equal(state.kind, "ready", state.message);
        assert.equal(state.currentSessionId, CHILD_ID);
        assert.deepEqual(
            state.lanes.map((lane) => ({
                id: lane.session.id,
                current: lane.session.current,
                turns: lane.turns.map((turn) => turn.userContent),
            })),
            [
                {
                    id: PARENT_ID,
                    current: false,
                    turns: ["Shared prompt", "Parent-only prompt"],
                },
                {
                    id: CHILD_ID,
                    current: true,
                    turns: ["Child-only prompt"],
                },
            ],
        );
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("reconstructs stable siblings and deep descendants from any nested member", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-family-nested-"),
    );
    const lineageStore = createLineageStore({
        filePath: path.join(temporaryRoot, "lineage-v1.json"),
    });
    await lineageStore.recordFork(nestedForkRecord(CHILD_ID, 1, "01"));
    await lineageStore.recordFork({
        ...nestedForkRecord(SIBLING_ID, 2, "03"),
        childForkMarkerEventId: "55555555-5555-4555-8555-555555555555",
    });
    await lineageStore.recordFork({
        parentSessionId: CHILD_ID,
        childSessionId: GRANDCHILD_ID,
        sourceUserEventId: "66666666-6666-4666-8666-666666666666",
        sourceAssistantEventId: "77777777-7777-4777-8777-777777777777",
        toEventId: "88888888-8888-4888-8888-888888888888",
        childForkMarkerEventId: "99999999-9999-4999-8999-999999999999",
        siblingOrdinal: 1,
        createdAt: "2026-08-21T02:00:00.000Z",
    });
    await lineageStore.recordFork({
        parentSessionId: PARENT_ID,
        childSessionId: LATE_SIBLING_ID,
        sourceUserEventId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        sourceAssistantEventId: "12121212-3434-4212-8212-121212121212",
        toEventId: null,
        childForkMarkerEventId: "46464646-4646-4646-8646-464646464646",
        siblingOrdinal: 1,
        createdAt: "2026-08-21T04:00:00.000Z",
    });

    try {
        const state = await loadCurrentSessionMap(testSession(GRANDCHILD_ID), {
            lineageStore,
            readEvents: async (sessionId) => nestedEvents(sessionId),
            listSessions: async () =>
                [
                    PARENT_ID,
                    CHILD_ID,
                    SIBLING_ID,
                    GRANDCHILD_ID,
                    LATE_SIBLING_ID,
                ].map((sessionId, index) => ({
                        sessionId,
                        name: `Lane ${index + 1}`,
                        summary: "",
                        modifiedTime: `2026-08-21T0${9 - index}:00:00.000Z`,
                        isRemote: false,
                    })),
            checkInUse: async () => new Set([GRANDCHILD_ID]),
        });

        assert.equal(state.kind, "ready", state.message);
        assert.equal(state.currentSessionId, GRANDCHILD_ID);
        assert.deepEqual(
            state.lanes.map((lane) => ({
                id: lane.session.id,
                current: lane.session.current,
                parentSessionId: lane.parentSessionId,
                sourceSessionId: lane.sourceCheckpoint?.sessionId || null,
                inheritedTurnCount: lane.inheritedTurnCount,
                turns: lane.turns.map((turn) => turn.userContent),
            })),
            [
                {
                    id: PARENT_ID,
                    current: false,
                    parentSessionId: null,
                    sourceSessionId: null,
                    inheritedTurnCount: 0,
                    turns: ["Shared prompt", "Root-only prompt"],
                },
                {
                    id: CHILD_ID,
                    current: false,
                    parentSessionId: PARENT_ID,
                    sourceSessionId: PARENT_ID,
                    inheritedTurnCount: 1,
                    turns: ["First child prompt", "Later child prompt"],
                },
                {
                    id: GRANDCHILD_ID,
                    current: true,
                    parentSessionId: CHILD_ID,
                    sourceSessionId: CHILD_ID,
                    inheritedTurnCount: 2,
                    turns: ["Grandchild-only prompt"],
                },
                {
                    id: SIBLING_ID,
                    current: false,
                    parentSessionId: PARENT_ID,
                    sourceSessionId: PARENT_ID,
                    inheritedTurnCount: 1,
                    turns: ["Sibling-only prompt"],
                },
                {
                    id: LATE_SIBLING_ID,
                    current: false,
                    parentSessionId: PARENT_ID,
                    sourceSessionId: PARENT_ID,
                    inheritedTurnCount: 2,
                    turns: ["Later sibling prompt"],
                },
            ],
        );
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("refreshes current metadata and availability for every family lane", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-family-metadata-"),
    );
    const lineageStore = createLineageStore({
        filePath: path.join(temporaryRoot, "lineage-v1.json"),
    });

    await lineageStore.recordFork(forkRecord());
    let childAvailable = true;

    try {
        const dependencies = {
            lineageStore,
            readEvents: async (sessionId) =>
                sessionId === PARENT_ID ? parentEvents() : childEvents(),
            listSessions: async () =>
                childAvailable
                    ? sessionMetadata()
                    : sessionMetadata().filter(
                          (entry) => entry.sessionId !== CHILD_ID,
                      ),
            checkInUse: async () => new Set(),
        };

        const first = await loadCurrentSessionMap(
            testSession(PARENT_ID),
            dependencies,
        );
        childAvailable = false;
        const refreshed = await loadCurrentSessionMap(
            testSession(PARENT_ID),
            dependencies,
        );

        assert.equal(first.kind, "ready", first.message);
        assert.deepEqual(first.lanes[1].session, {
            id: CHILD_ID,
            title: "Child now",
            summary: "Child summary",
            modifiedTime: "2026-08-20T07:30:00.000Z",
            available: true,
            inUse: false,
            current: false,
        });
        assert.equal(refreshed.kind, "ready", refreshed.message);
        assert.deepEqual(refreshed.lanes[1].session, {
            id: CHILD_ID,
            title: "Session unavailable",
            summary: "",
            modifiedTime: null,
            available: false,
            inUse: false,
            current: false,
        });
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("keeps a deleted parent as a Tombstone with its child attached", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-family-tombstone-"),
    );
    const lineageStore = createLineageStore({
        filePath: path.join(temporaryRoot, "lineage-v1.json"),
    });
    await lineageStore.recordFork(forkRecord());

    try {
        const state = await loadCurrentSessionMap(testSession(CHILD_ID), {
            lineageStore,
            readEvents: async (sessionId) => {
                if (sessionId === PARENT_ID) {
                    throw Object.assign(new Error("Deleted"), { code: "ENOENT" });
                }
                return childEvents();
            },
            listSessions: async () =>
                sessionMetadata().filter(
                    (entry) => entry.sessionId === CHILD_ID,
                ),
            checkInUse: async () => new Set(),
        });

        assert.equal(state.kind, "ready", state.message);
        assert.equal(state.lanes[0].session.available, false);
        assert.equal(state.lanes[0].session.title, "Session unavailable");
        assert.equal(state.lanes[1].parentSessionId, PARENT_ID);
        assert.equal(state.lanes[1].sourceCheckpoint.available, false);
        assert.deepEqual(
            state.lanes[1].turns.map((turn) => turn.userContent),
            ["Child-only prompt"],
        );
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("keeps a missing source turn as an unavailable checkpoint anchor", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-family-missing-checkpoint-"),
    );
    const lineageStore = createLineageStore({
        filePath: path.join(temporaryRoot, "lineage-v1.json"),
    });
    await lineageStore.recordFork(forkRecord());

    try {
        const state = await loadCurrentSessionMap(testSession(PARENT_ID), {
            lineageStore,
            readEvents: async (sessionId) =>
                sessionId === PARENT_ID
                    ? [
                          user(
                              "31313131-3131-4131-8131-313131313131",
                              "Different history",
                          ),
                      ]
                    : childEvents(),
            listSessions: async () => sessionMetadata(),
            checkInUse: async () => new Set(),
        });

        assert.equal(state.kind, "ready", state.message);
        assert.deepEqual(state.lanes[1].sourceCheckpoint, {
            sessionId: PARENT_ID,
            turnId: SOURCE_USER_ID,
            available: false,
        });
        assert.equal(state.lanes[1].parentSessionId, PARENT_ID);
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("surfaces event corruption while preserving trustworthy turns", async () => {
    const trustworthy = parentEvents().slice(0, 3);
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-family-corrupt-events-"),
    );
    try {
        const state = await loadCurrentSessionMap(testSession(PARENT_ID), {
            lineageStore: createLineageStore({
                filePath: path.join(temporaryRoot, "lineage-v1.json"),
            }),
            readEvents: async () => {
                throw Object.assign(
                    new Error("Invalid Copilot event log JSON at line 4"),
                    {
                        code: "EVENT_LOG_CORRUPT",
                        events: trustworthy,
                    },
                );
            },
            listSessions: async () => sessionMetadata(),
            checkInUse: async () => new Set(),
        });

        assert.equal(state.kind, "ready", state.message);
        assert.deepEqual(
            state.lanes[0].turns.map((turn) => turn.userContent),
            ["Shared prompt"],
        );
        assert.match(state.lanes[0].error, /line 4/);
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("reads live local metadata through the joined session runtime", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-family-runtime-"),
    );
    const session = testSession(PARENT_ID);
    session.rpc.sessions.list = async () => ({ sessions: sessionMetadata() });
    session.rpc.sessions.checkInUse = async () => ({
        inUse: [PARENT_ID],
    });

    try {
        const state = await loadCurrentSessionMap(session, {
            lineageStore: createLineageStore({
                filePath: path.join(temporaryRoot, "lineage-v1.json"),
            }),
            readEvents: async () => parentEvents(),
        });

        assert.equal(state.kind, "ready", state.message);
        assert.deepEqual(state.session, {
            id: PARENT_ID,
            title: "Current name",
            summary: "Current summary",
            modifiedTime: "2026-08-20T08:00:00.000Z",
            available: true,
            inUse: true,
            current: true,
        });
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("restores the family when host navigation is unavailable", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-family-no-navigation-"),
    );
    const session = testSession(PARENT_ID);
    delete session.rpc.commands;

    try {
        const state = await loadCurrentSessionMap(session, {
            lineageStore: createLineageStore({
                filePath: path.join(temporaryRoot, "lineage-v1.json"),
            }),
            readEvents: async () => parentEvents(),
            listSessions: async () => sessionMetadata(),
            checkInUse: async () => new Set(),
        });

        assert.equal(state.kind, "ready", state.message);
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("surfaces corrupt Conversation Family trees instead of rendering them", async () => {
    const invalidIndexes = [
        cycleIndex(),
        multipleParentsIndex(),
        crossFamilyParentIndex(),
    ];

    for (const [index, invalid] of invalidIndexes.entries()) {
        const temporaryRoot = await mkdtemp(
            path.join(os.tmpdir(), `chat-fork-family-invalid-${index}-`),
        );
        const filePath = path.join(temporaryRoot, "lineage-v1.json");
        await writeFile(filePath, JSON.stringify(invalid), "utf8");

        try {
            const state = await loadCurrentSessionMap(testSession(PARENT_ID), {
                lineageStore: createLineageStore({ filePath }),
                readEvents: async () => parentEvents(),
                listSessions: async () => sessionMetadata(),
                checkInUse: async () => new Set(),
            });

            assert.equal(state.kind, "error");
            assert.match(state.message, /Could not restore the Conversation Family/);
            assert.match(state.message, /Invalid Conversation Fork Map lineage/);
        } finally {
            await rm(temporaryRoot, { recursive: true, force: true });
        }
    }
});

test("rejects a contradictory child fork marker", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-family-marker-"),
    );
    const lineageStore = createLineageStore({
        filePath: path.join(temporaryRoot, "lineage-v1.json"),
    });
    await lineageStore.recordFork(forkRecord());
    const contradictoryChildEvents = childEvents();
    contradictoryChildEvents[3] = user(CHILD_MARKER_ID, "Not a fork marker");

    try {
        const state = await loadCurrentSessionMap(testSession(PARENT_ID), {
            lineageStore,
            readEvents: async (sessionId) =>
                sessionId === PARENT_ID
                    ? parentEvents()
                    : contradictoryChildEvents,
            listSessions: async () => sessionMetadata(),
            checkInUse: async () => new Set(),
        });

        assert.equal(state.kind, "error");
        assert.match(state.message, /fork marker is contradictory/i);
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("rejects a Fork Checkpoint that contradicts the parent transcript", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-family-checkpoint-"),
    );
    const lineageStore = createLineageStore({
        filePath: path.join(temporaryRoot, "lineage-v1.json"),
    });
    await lineageStore.recordFork({
        ...forkRecord(),
        sourceAssistantEventId:
            "15151515-1515-4515-8515-151515151515",
    });

    try {
        const state = await loadCurrentSessionMap(testSession(PARENT_ID), {
            lineageStore,
            readEvents: async (sessionId) =>
                sessionId === PARENT_ID ? parentEvents() : childEvents(),
            listSessions: async () => sessionMetadata(),
            checkInUse: async () => new Set(),
        });

        assert.equal(state.kind, "error");
        assert.match(state.message, /Fork checkpoint is contradictory/);
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("keeps a final-turn fork valid after the parent continues", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-family-parent-continued-"),
    );
    const lineageStore = createLineageStore({
        filePath: path.join(temporaryRoot, "lineage-v1.json"),
    });
    await lineageStore.recordFork({
        ...forkRecord(),
        toEventId: null,
    });

    try {
        const state = await loadCurrentSessionMap(testSession(PARENT_ID), {
            lineageStore,
            readEvents: async (sessionId) =>
                sessionId === PARENT_ID ? parentEvents() : childEvents(),
            listSessions: async () => sessionMetadata(),
            checkInUse: async () => new Set(),
        });

        assert.equal(state.kind, "ready", state.message);
        assert.deepEqual(
            state.lanes[1].turns.map((turn) => turn.userContent),
            ["Child-only prompt"],
        );
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("uses the child marker when the parent records fork events before continuing", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-family-parent-fork-events-"),
    );
    const lineageStore = createLineageStore({
        filePath: path.join(temporaryRoot, "lineage-v1.json"),
    });
    await lineageStore.recordFork({
        ...forkRecord(),
        toEventId: null,
    });
    const parentWithForkEvents = [
        ...parentEvents().slice(0, 3),
        {
            id: "16161616-1616-4616-8616-161616161616",
            type: "session.canvas.recorded",
            data: {},
        },
        {
            id: "17171717-1717-4717-8717-171717171717",
            type: "session.info",
            data: { infoType: "fork", message: "Forked session" },
        },
        {
            id: "18181818-1818-4818-8818-181818181818",
            type: "session.model_change",
            data: {},
        },
        ...parentEvents().slice(3),
    ];
    const childWithForkEvents = [
        ...childEvents().slice(0, 3),
        {
            id: "16161616-1616-4616-8616-161616161616",
            type: "session.canvas.recorded",
            data: {},
        },
        childEvents()[3],
    ];

    try {
        const state = await loadCurrentSessionMap(testSession(PARENT_ID), {
            lineageStore,
            readEvents: async (sessionId) =>
                sessionId === PARENT_ID
                    ? parentWithForkEvents
                    : childWithForkEvents,
            listSessions: async () => sessionMetadata(),
            checkInUse: async () => new Set(),
        });

        assert.equal(state.kind, "ready", state.message);
        assert.deepEqual(state.lanes[1].turns, []);
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

function testSession(sessionId) {
    return {
        sessionId,
        capabilities: { ui: { canvases: true } },
        rpc: {
            canvas: { open: async () => undefined },
            metadata: {
                snapshot: async () => ({
                    isRemote: false,
                    initialName: "Current name",
                    summary: "Current summary",
                    modifiedTime: "2026-08-20T08:00:00.000Z",
                }),
                isProcessing: async () => ({ processing: false }),
            },
            name: { get: async () => ({ name: "Current name" }) },
            commands: { enqueue: async () => ({ queued: true }) },
            sessions: { fork: async () => undefined },
        },
    };
}

function sessionMetadata() {
    return [
        {
            sessionId: CHILD_ID,
            name: "Child now",
            summary: "Child summary",
            modifiedTime: "2026-08-20T07:30:00.000Z",
            isRemote: false,
        },
        {
            sessionId: PARENT_ID,
            name: "Parent now",
            summary: "Parent summary",
            modifiedTime: "2026-08-20T08:00:00.000Z",
            isRemote: false,
        },
    ];
}

function forkRecord() {
    return {
        parentSessionId: PARENT_ID,
        childSessionId: CHILD_ID,
        sourceUserEventId: SOURCE_USER_ID,
        sourceAssistantEventId: SOURCE_ASSISTANT_ID,
        toEventId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        childForkMarkerEventId: CHILD_MARKER_ID,
        siblingOrdinal: 1,
        createdAt: "2026-08-20T07:00:00.000Z",
    };
}

function parentEvents() {
    return [
        user(SOURCE_USER_ID, "Shared prompt"),
        assistant(SOURCE_ASSISTANT_ID, "Shared answer"),
        turnEnd("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
        user("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "Parent-only prompt"),
        assistant("ffffffff-ffff-4fff-8fff-ffffffffffff", "Parent-only answer"),
        turnEnd("99999999-9999-4999-8999-999999999999"),
    ];
}

function childEvents() {
    return [
        user(SOURCE_USER_ID, "Shared prompt"),
        assistant(SOURCE_ASSISTANT_ID, "Shared answer"),
        turnEnd("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
        {
            id: CHILD_MARKER_ID,
            type: "session.info",
            data: { infoType: "fork", message: "Forked session" },
        },
        user("12121212-1212-4212-8212-121212121212", "Child-only prompt"),
        assistant("13131313-1313-4313-8313-131313131313", "Child-only answer"),
        turnEnd("14141414-1414-4414-8414-141414141414"),
    ];
}

function nestedForkRecord(childSessionId, siblingOrdinal, hour) {
    return {
        ...forkRecord(),
        childSessionId,
        siblingOrdinal,
        createdAt: `2026-08-21T${hour}:00:00.000Z`,
    };
}

function nestedEvents(sessionId) {
    const shared = [
        user(SOURCE_USER_ID, "Shared prompt"),
        assistant(SOURCE_ASSISTANT_ID, "Shared answer"),
        turnEnd("10101010-1010-4010-8010-101010101010"),
    ];
    const firstChild = [
        user("66666666-6666-4666-8666-666666666666", "First child prompt"),
        assistant("77777777-7777-4777-8777-777777777777", "First child answer"),
        turnEnd("11111111-2222-4111-8111-111111111111"),
    ];
    if (sessionId === PARENT_ID) {
        return [
            ...shared,
            user("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "Root-only prompt"),
            assistant("12121212-3434-4212-8212-121212121212", "Root-only answer"),
            turnEnd("13131313-3434-4313-8313-131313131313"),
        ];
    }
    if (sessionId === CHILD_ID) {
        return [
            ...shared,
            {
                id: CHILD_MARKER_ID,
                type: "session.info",
                data: { infoType: "fork", message: "Forked session" },
            },
            ...firstChild,
            user("88888888-8888-4888-8888-888888888888", "Later child prompt"),
            assistant("14141414-3434-4414-8414-141414141414", "Later child answer"),
            turnEnd("15151515-3434-4515-8515-151515151515"),
        ];
    }
    if (sessionId === SIBLING_ID) {
        return [
            ...shared,
            {
                id: "55555555-5555-4555-8555-555555555555",
                type: "session.info",
                data: { infoType: "fork", message: "Forked session" },
            },
            user("16161616-3434-4616-8616-161616161616", "Sibling-only prompt"),
            assistant("17171717-3434-4717-8717-171717171717", "Sibling answer"),
            turnEnd("18181818-3434-4818-8818-181818181818"),
        ];
    }
    if (sessionId === LATE_SIBLING_ID) {
        return [
            ...shared,
            user("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "Root-only prompt"),
            assistant("12121212-3434-4212-8212-121212121212", "Root-only answer"),
            turnEnd("13131313-3434-4313-8313-131313131313"),
            {
                id: "46464646-4646-4646-8646-464646464646",
                type: "session.info",
                data: { infoType: "fork", message: "Forked session" },
            },
            user("47474747-4747-4747-8747-474747474747", "Later sibling prompt"),
            assistant("48484848-4848-4848-8848-484848484848", "Later answer"),
            turnEnd("49494949-4949-4949-8949-494949494949"),
        ];
    }
    return [
        ...shared,
        {
            id: CHILD_MARKER_ID,
            type: "session.info",
            data: { infoType: "fork", message: "Forked session" },
        },
        ...firstChild,
        {
            id: "99999999-9999-4999-8999-999999999999",
            type: "session.info",
            data: { infoType: "fork", message: "Forked session" },
        },
        user("19191919-3434-4919-8919-191919191919", "Grandchild-only prompt"),
        assistant("20202020-3434-4020-8020-202020202020", "Grandchild answer"),
        turnEnd("21212121-3434-4121-8121-212121212121"),
    ];
}

function user(id, content) {
    return { id, type: "user.message", data: { content, source: "user" } };
}

function assistant(id, content) {
    return { id, type: "assistant.message", data: { content } };
}

function turnEnd(id) {
    return { id, type: "assistant.turn_end", data: {} };
}

function cycleIndex() {
    const index = validIndex();
    index.families[PARENT_ID].members[PARENT_ID].parentSessionId = CHILD_ID;
    index.families[PARENT_ID].members[PARENT_ID].sourceUserEventId =
        SOURCE_USER_ID;
    index.families[PARENT_ID].members[PARENT_ID].sourceAssistantEventId =
        SOURCE_ASSISTANT_ID;
    index.families[PARENT_ID].members[PARENT_ID].siblingOrdinal = 1;
    return index;
}

function multipleParentsIndex() {
    const otherRoot = "33333333-3333-4333-8333-333333333333";
    const index = validIndex();
    index.families[otherRoot] = {
        familyId: otherRoot,
        rootSessionId: otherRoot,
        createdAt: "2026-08-20T07:00:00.000Z",
        members: {
            [otherRoot]: rootMember(otherRoot),
            [CHILD_ID]: {
                ...index.families[PARENT_ID].members[CHILD_ID],
                parentSessionId: otherRoot,
            },
        },
        hiddenSessionIds: [],
    };
    return index;
}

function crossFamilyParentIndex() {
    const otherRoot = "33333333-3333-4333-8333-333333333333";
    const index = validIndex();
    index.families[PARENT_ID].members[CHILD_ID].parentSessionId = otherRoot;
    index.families[otherRoot] = {
        familyId: otherRoot,
        rootSessionId: otherRoot,
        createdAt: "2026-08-20T07:00:00.000Z",
        members: { [otherRoot]: rootMember(otherRoot) },
        hiddenSessionIds: [],
    };
    index.sessionToFamily[otherRoot] = otherRoot;
    return index;
}

function validIndex() {
    return {
        version: 1,
        revision: 1,
        families: {
            [PARENT_ID]: {
                familyId: PARENT_ID,
                rootSessionId: PARENT_ID,
                createdAt: "2026-08-20T07:00:00.000Z",
                members: {
                    [PARENT_ID]: rootMember(PARENT_ID),
                    [CHILD_ID]: {
                        sessionId: CHILD_ID,
                        parentSessionId: PARENT_ID,
                        sourceUserEventId: SOURCE_USER_ID,
                        sourceAssistantEventId: SOURCE_ASSISTANT_ID,
                        toEventId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                        childForkMarkerEventId: CHILD_MARKER_ID,
                        siblingOrdinal: 1,
                        createdAt: "2026-08-20T07:00:00.000Z",
                    },
                },
                hiddenSessionIds: [],
            },
        },
        sessionToFamily: {
            [PARENT_ID]: PARENT_ID,
            [CHILD_ID]: PARENT_ID,
        },
    };
}

function rootMember(sessionId) {
    return {
        sessionId,
        parentSessionId: null,
        sourceUserEventId: null,
        sourceAssistantEventId: null,
        toEventId: null,
        childForkMarkerEventId: null,
        siblingOrdinal: 0,
        createdAt: "2026-08-20T07:00:00.000Z",
    };
}
