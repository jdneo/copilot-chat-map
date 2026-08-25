import { watch } from "node:fs";
import path from "node:path";

import { resolveEventLogPath } from "./event-reader.mjs";

const WATCH_DEBOUNCE_MS = 200;
const RECONCILIATION_MS = 15_000;

export function createFamilyLiveSync({
    onInvalidate,
    resolveWatchPath = (sessionId) =>
        path.dirname(resolveEventLogPath(sessionId)),
    watchDirectory = (directoryPath, listener) =>
        watch(directoryPath, { persistent: false }, listener),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    setRepeater = setInterval,
    clearRepeater = clearInterval,
    debounceMs = WATCH_DEBOUNCE_MS,
    reconciliationMs = RECONCILIATION_MS,
}) {
    const watchers = new Map();
    let debounceTimer;
    let closed = false;

    function scheduleInvalidation(reason = "events") {
        if (closed) return;
        if (debounceTimer) clearTimer(debounceTimer);
        debounceTimer = setTimer(() => {
            debounceTimer = undefined;
            onInvalidate(reason);
        }, debounceMs);
        debounceTimer?.unref?.();
    }

    function update(snapshot) {
        if (closed) return;
        const sessionIds = new Set(
            snapshot?.kind === "ready"
                ? snapshot.lanes.map((lane) => lane.session.id)
                : [],
        );
        for (const [sessionId, watcher] of watchers) {
            if (sessionIds.has(sessionId)) continue;
            watcher.close();
            watchers.delete(sessionId);
        }
        for (const sessionId of sessionIds) {
            if (watchers.has(sessionId)) continue;
            try {
                const watcher = watchDirectory(
                    resolveWatchPath(sessionId),
                    (_eventType, filename) => {
                        if (
                            filename === undefined ||
                            String(filename).toLowerCase() === "events.jsonl"
                        ) {
                            scheduleInvalidation("events");
                        }
                    },
                );
                watcher.on?.("error", () => {
                    watcher.close();
                    if (watchers.get(sessionId) === watcher) {
                        watchers.delete(sessionId);
                    }
                });
                watchers.set(sessionId, watcher);
            } catch {
                // Reconciliation retries sessions whose directory is unavailable.
            }
        }
    }

    const reconciliationTimer = setRepeater(
        () => onInvalidate("reconcile"),
        reconciliationMs,
    );
    reconciliationTimer?.unref?.();

    function close() {
        if (closed) return;
        closed = true;
        if (debounceTimer) clearTimer(debounceTimer);
        clearRepeater(reconciliationTimer);
        for (const watcher of watchers.values()) watcher.close();
        watchers.clear();
    }

    return { update, close };
}
