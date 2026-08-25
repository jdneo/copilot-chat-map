import assert from "node:assert/strict";
import test from "node:test";

import { createFamilyLiveSync } from "../extension/live-sync.mjs";

test("debounces event log notifications for known family members", () => {
    const callbacks = new Map();
    const timers = [];
    const invalidations = [];
    const sync = createFamilyLiveSync({
        onInvalidate: (reason) => invalidations.push(reason),
        resolveWatchPath: (sessionId) => sessionId,
        watchDirectory: (sessionId, callback) => {
            callbacks.set(sessionId, callback);
            return { close() {} };
        },
        setTimer: (callback) => {
            timers.push(callback);
            return timers.length;
        },
        clearTimer: () => undefined,
        setRepeater: () => 1,
        clearRepeater: () => undefined,
    });

    sync.update(snapshot(["session-1", "session-2"]));
    callbacks.get("session-1")("change", "events.jsonl");
    callbacks.get("session-1")("change", "events.jsonl");
    callbacks.get("session-2")("change", "other-file");
    timers.at(-1)();

    assert.deepEqual(invalidations, ["events"]);
    sync.close();
});

test("runs low-frequency reconciliation and closes stale watchers", () => {
    let reconcile;
    const closed = [];
    const invalidations = [];
    const sync = createFamilyLiveSync({
        onInvalidate: (reason) => invalidations.push(reason),
        resolveWatchPath: (sessionId) => sessionId,
        watchDirectory: (sessionId) => ({
            close: () => closed.push(sessionId),
        }),
        setRepeater: (callback, milliseconds) => {
            assert.equal(milliseconds, 15_000);
            reconcile = callback;
            return 1;
        },
        clearRepeater: () => undefined,
    });

    sync.update(snapshot(["session-1", "session-2"]));
    sync.update(snapshot(["session-2"]));
    reconcile();

    assert.deepEqual(closed, ["session-1"]);
    assert.deepEqual(invalidations, ["reconcile"]);
    sync.close();
    assert.deepEqual(closed, ["session-1", "session-2"]);
});

function snapshot(sessionIds) {
    return {
        kind: "ready",
        lanes: sessionIds.map((id) => ({ session: { id } })),
    };
}
