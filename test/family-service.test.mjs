import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadCurrentSessionMap } from "../extension/family-service.mjs";
import { createLineageStore } from "../extension/lineage-store.mjs";

const PARENT_ID = "11111111-1111-4111-8111-111111111111";
const CHILD_ID = "22222222-2222-4222-8222-222222222222";
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
