import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createLineageStore } from "../extensions/chat-fork-map/lineage-store.mjs";

const ROOT_ID = "11111111-1111-4111-8111-111111111111";

test("serializes concurrent lineage updates without losing a child", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-atomic-"),
    );
    const store = createLineageStore({
        filePath: path.join(temporaryRoot, "lineage-v1.json"),
    });

    try {
        await Promise.all([
            store.recordFork(record("22222222-2222-4222-8222-222222222222", 1)),
            store.recordFork(record("33333333-3333-4333-8333-333333333333", 2)),
        ]);

        const lineage = await store.read();
        assert.equal(lineage.revision, 2);
        assert.deepEqual(
            Object.keys(lineage.families[ROOT_ID].members).sort(),
            [
                ROOT_ID,
                "22222222-2222-4222-8222-222222222222",
                "33333333-3333-4333-8333-333333333333",
            ],
        );
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("rejects lineage that is not a Conversation Family tree", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-invalid-tree-"),
    );
    const filePath = path.join(temporaryRoot, "lineage-v1.json");
    const firstChild = "22222222-2222-4222-8222-222222222222";
    const secondChild = "33333333-3333-4333-8333-333333333333";
    const invalid = {
        version: 1,
        revision: 2,
        families: {
            [ROOT_ID]: {
                familyId: ROOT_ID,
                rootSessionId: ROOT_ID,
                createdAt: "2026-08-20T07:00:00.000Z",
                members: {
                    [ROOT_ID]: member(ROOT_ID, null),
                    [firstChild]: member(firstChild, secondChild),
                    [secondChild]: member(secondChild, firstChild),
                },
                hiddenSessionIds: [],
            },
        },
        sessionToFamily: {
            [ROOT_ID]: ROOT_ID,
            [firstChild]: ROOT_ID,
            [secondChild]: ROOT_ID,
        },
    };
    await writeFile(filePath, JSON.stringify(invalid), "utf8");
    const store = createLineageStore({ filePath });

    try {
        await assert.rejects(store.read(), {
            name: "TypeError",
            message: `Invalid Conversation Fork Map lineage at ${filePath}.`,
        });
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("recovers a lineage lock left by a terminated process", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-stale-lock-"),
    );
    const filePath = path.join(temporaryRoot, "lineage-v1.json");
    await writeFile(
        `${filePath}.lock`,
        JSON.stringify({
            pid: 2_147_483_647,
            createdAt: "2020-01-01T00:00:00.000Z",
        }),
        "utf8",
    );
    const store = createLineageStore({
        filePath,
        lockTimeoutMs: 100,
    });

    try {
        await store.recordFork(
            record("22222222-2222-4222-8222-222222222222", 1),
        );

        assert.equal((await store.read()).revision, 1);
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("persists hidden unavailable subtree roots without rewriting lineage", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-hidden-"),
    );
    const store = createLineageStore({
        filePath: path.join(temporaryRoot, "lineage-v1.json"),
    });
    const childId = "22222222-2222-4222-8222-222222222222";

    try {
        await store.recordFork(record(childId, 1));
        await store.setSessionHidden({
            currentSessionId: ROOT_ID,
            targetSessionId: childId,
            hidden: true,
        });
        let lineage = await store.read();
        assert.equal(lineage.revision, 2);
        assert.deepEqual(lineage.families[ROOT_ID].hiddenSessionIds, [childId]);
        assert.equal(
            lineage.families[ROOT_ID].members[childId].parentSessionId,
            ROOT_ID,
        );

        await store.setSessionHidden({
            currentSessionId: ROOT_ID,
            targetSessionId: childId,
            hidden: false,
        });
        lineage = await store.read();
        assert.equal(lineage.revision, 3);
        assert.deepEqual(lineage.families[ROOT_ID].hiddenSessionIds, []);
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

function record(childSessionId, siblingOrdinal) {
    return {
        parentSessionId: ROOT_ID,
        childSessionId,
        sourceUserEventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        sourceAssistantEventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        toEventId: null,
        childForkMarkerEventId: null,
        siblingOrdinal,
        createdAt: "2026-08-20T07:00:00.000Z",
    };
}

function member(sessionId, parentSessionId) {
    return {
        sessionId,
        parentSessionId,
        sourceUserEventId: parentSessionId ? "user-event" : null,
        sourceAssistantEventId: parentSessionId ? "assistant-event" : null,
        toEventId: null,
        childForkMarkerEventId: null,
        siblingOrdinal: parentSessionId ? 1 : 0,
        createdAt: "2026-08-20T07:00:00.000Z",
    };
}
