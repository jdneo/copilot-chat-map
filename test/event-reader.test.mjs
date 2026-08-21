import assert from "node:assert/strict";
import {
    appendFile,
    mkdir,
    mkdtemp,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    readSessionEvents,
    resolveEventLogPath,
} from "../extension/event-reader.mjs";

test("resolves the Windows event log below the default Copilot home", () => {
    assert.equal(
        resolveEventLogPath("3bc4d926-f2d2-48ec-81fb-aafb579e671a", {
            platform: "win32",
            env: {},
            homedir: "C:\\Users\\octocat",
        }),
        "C:\\Users\\octocat\\.copilot\\session-state\\3bc4d926-f2d2-48ec-81fb-aafb579e671a\\events.jsonl",
    );
});

test("rejects a session ID that could escape the session-state root", () => {
    assert.throws(
        () =>
            resolveEventLogPath("..\\outside", {
                platform: "win32",
                env: {},
                homedir: "C:\\Users\\octocat",
            }),
        {
            name: "TypeError",
            message: "Invalid local Copilot session ID: ..\\outside",
        },
    );
});

test("resolves macOS and Linux event logs with default and overridden homes", () => {
    const sessionId = "3bc4d926-f2d2-48ec-81fb-aafb579e671a";

    assert.equal(
        resolveEventLogPath(sessionId, {
            platform: "darwin",
            env: {},
            homedir: "/Users/octocat",
        }),
        `/Users/octocat/.copilot/session-state/${sessionId}/events.jsonl`,
    );
    assert.equal(
        resolveEventLogPath(sessionId, {
            platform: "linux",
            env: { COPILOT_HOME: "/opt/copilot" },
            homedir: "/home/ignored",
        }),
        `/opt/copilot/session-state/${sessionId}/events.jsonl`,
    );
    assert.equal(
        resolveEventLogPath(sessionId, {
            platform: "win32",
            env: { COPILOT_HOME: "D:\\Copilot" },
            homedir: "C:\\Users\\ignored",
        }),
        `D:\\Copilot\\session-state\\${sessionId}\\events.jsonl`,
    );
});

test("rejects a valid session ID whose event log resolves outside session-state", async () => {
    const sessionId = "3bc4d926-f2d2-48ec-81fb-aafb579e671a";
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-map-"),
    );
    const copilotHome = path.join(temporaryRoot, ".copilot");
    const sessionStateRoot = path.join(copilotHome, "session-state");
    const outsideDirectory = path.join(temporaryRoot, "outside");

    try {
        await mkdir(sessionStateRoot, { recursive: true });
        await mkdir(outsideDirectory);
        await writeFile(
            path.join(outsideDirectory, "events.jsonl"),
            '{"type":"session.start"}\n',
        );
        await symlink(
            outsideDirectory,
            path.join(sessionStateRoot, sessionId),
            process.platform === "win32" ? "junction" : "dir",
        );

        await assert.rejects(
            readSessionEvents(sessionId, {
                platform: process.platform,
                env: { COPILOT_HOME: copilotHome },
                homedir: os.homedir(),
            }),
            {
                name: "TypeError",
                message: `Resolved session path is outside session-state: ${sessionId}`,
            },
        );
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("retains the parsed prefix when new session events are appended", async () => {
    const sessionId = "3bc4d926-f2d2-48ec-81fb-aafb579e671a";
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-map-incremental-"),
    );
    const copilotHome = path.join(temporaryRoot, ".copilot");
    const sessionDirectory = path.join(
        copilotHome,
        "session-state",
        sessionId,
    );
    const eventLogPath = path.join(sessionDirectory, "events.jsonl");
    const options = {
        platform: process.platform,
        env: { COPILOT_HOME: copilotHome },
        homedir: os.homedir(),
    };

    try {
        await mkdir(sessionDirectory, { recursive: true });
        await writeFile(
            eventLogPath,
            [
                JSON.stringify({ id: "event-1", type: "user.message", data: {} }),
                JSON.stringify({
                    id: "event-2",
                    type: "assistant.message",
                    data: {},
                }),
                "",
            ].join("\n"),
        );
        const initial = await readSessionEvents(sessionId, options);

        await appendFile(
            eventLogPath,
            `${JSON.stringify({ id: "event-3", type: "turn.end", data: {} })}\n`,
        );
        const appended = await readSessionEvents(sessionId, options);

        assert.deepEqual(
            appended.map((event) => event.id),
            ["event-1", "event-2", "event-3"],
        );
        assert.equal(appended[0], initial[0]);
        assert.equal(appended[1], initial[1]);
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});
