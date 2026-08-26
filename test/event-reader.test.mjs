import assert from "node:assert/strict";
import {
    appendFile,
    mkdir,
    mkdtemp,
    rename,
    rm,
    symlink,
    truncate,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    assertReadableEventLogRoot,
    EventLogReadError,
    readSessionEvents,
    resolveEventLogPath,
} from "../extensions/chat-fork-map/event-reader.mjs";

test("accepts only a readable Copilot session-state directory", async () => {
    const copilotHome = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-readable-root-"),
    );
    try {
        await mkdir(path.join(copilotHome, "session-state"));
        await assertReadableEventLogRoot({
            env: { COPILOT_HOME: copilotHome },
        });

        await assert.rejects(
            assertReadableEventLogRoot({
                env: {
                    COPILOT_HOME: path.join(copilotHome, "missing"),
                },
            }),
            { code: "ENOENT" },
        );
    } finally {
        await rm(copilotHome, { recursive: true, force: true });
    }
});

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
            platform: "darwin",
            env: { COPILOT_HOME: "/opt/copilot" },
            homedir: "/Users/ignored",
        }),
        `/opt/copilot/session-state/${sessionId}/events.jsonl`,
    );
    assert.equal(
        resolveEventLogPath(sessionId, {
            platform: "linux",
            env: {},
            homedir: "/home/octocat",
        }),
        `/home/octocat/.copilot/session-state/${sessionId}/events.jsonl`,
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

test("defers and later recovers a partially written final JSONL record", async () => {
    const fixture = await eventLogFixture("chat-fork-map-partial-");
    try {
        await writeFile(
            fixture.eventLogPath,
            '{"id":"event-1","type":"user.message","data":{}}\n{"id":"event-2"',
        );

        assert.deepEqual(
            (await readSessionEvents(fixture.sessionId, fixture.options)).map(
                (event) => event.id,
            ),
            ["event-1"],
        );

        await appendFile(
            fixture.eventLogPath,
            ',"type":"assistant.message","data":{}}\n',
        );
        assert.deepEqual(
            (await readSessionEvents(fixture.sessionId, fixture.options)).map(
                (event) => event.id,
            ),
            ["event-1", "event-2"],
        );
    } finally {
        await fixture.cleanup();
    }
});

test("resets the incremental cache after truncation and replacement", async () => {
    const fixture = await eventLogFixture("chat-fork-map-reset-");
    try {
        await writeFile(
            fixture.eventLogPath,
            '{"id":"old-1","type":"user.message","data":{}}\n{"id":"old-2","type":"assistant.message","data":{}}\n',
        );
        await readSessionEvents(fixture.sessionId, fixture.options);

        await truncate(fixture.eventLogPath, 0);
        await appendFile(
            fixture.eventLogPath,
            '{"id":"truncated","type":"user.message","data":{}}\n',
        );
        assert.deepEqual(
            (await readSessionEvents(fixture.sessionId, fixture.options)).map(
                (event) => event.id,
            ),
            ["truncated"],
        );

        const replacement = `${fixture.eventLogPath}.replacement`;
        await writeFile(
            replacement,
            '{"id":"replacement","type":"user.message","data":{}}\n',
        );
        await rm(fixture.eventLogPath);
        await rename(replacement, fixture.eventLogPath);
        assert.deepEqual(
            (await readSessionEvents(fixture.sessionId, fixture.options)).map(
                (event) => event.id,
            ),
            ["replacement"],
        );

        await truncate(fixture.eventLogPath, 0);
        await appendFile(
            fixture.eventLogPath,
            `${JSON.stringify({
                id: "regrown",
                type: "user.message",
                data: { content: "x".repeat(256) },
            })}\n`,
        );
        assert.deepEqual(
            (await readSessionEvents(fixture.sessionId, fixture.options)).map(
                (event) => event.id,
            ),
            ["regrown"],
        );
    } finally {
        await fixture.cleanup();
    }
});

test("reports interior corruption with the last trustworthy events", async () => {
    const fixture = await eventLogFixture("chat-fork-map-corrupt-");
    try {
        await writeFile(
            fixture.eventLogPath,
            '{"id":"trusted","type":"user.message","data":{}}\nnot-json\n{"id":"ignored","type":"assistant.message","data":{}}\n',
        );

        await assert.rejects(
            readSessionEvents(fixture.sessionId, fixture.options),
            (error) => {
                assert.ok(error instanceof EventLogReadError);
                assert.match(error.message, /line 2/);
                assert.deepEqual(
                    error.events.map((event) => event.id),
                    ["trusted"],
                );
                return true;
            },
        );
    } finally {
        await fixture.cleanup();
    }
});

async function eventLogFixture(prefix) {
    const sessionId = "4bc4d926-f2d2-48ec-81fb-aafb579e671a";
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
    const copilotHome = path.join(temporaryRoot, ".copilot");
    const sessionDirectory = path.join(
        copilotHome,
        "session-state",
        sessionId,
    );
    const eventLogPath = path.join(sessionDirectory, "events.jsonl");
    await mkdir(sessionDirectory, { recursive: true });
    return {
        sessionId,
        eventLogPath,
        options: {
            platform: process.platform,
            env: { COPILOT_HOME: copilotHome },
            homedir: os.homedir(),
        },
        cleanup: () => rm(temporaryRoot, { recursive: true, force: true }),
    };
}
