import assert from "node:assert/strict";
import {
    mkdir,
    mkdtemp,
    readFile,
    rm,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runProcess } from "./fixtures/run-process.mjs";

const ROOT_ID = "11111111-1111-4111-8111-111111111111";
const CHILD_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOURCE_ASSISTANT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CHILD_MARKER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const installScript = path.join(
    repositoryRoot,
    "scripts",
    "install-user-extension.ps1",
);
const sdkLoader = path.join(
    repositoryRoot,
    "test",
    "fixtures",
    "copilot-sdk-loader.mjs",
);

test("reconnects the packaged user provider to each foreground family session", async () => {
    const copilotHome = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-map-provider-"),
    );
    try {
        const install = await runProcess(
            "pwsh",
            ["-NoLogo", "-NoProfile", "-File", installScript],
            { COPILOT_HOME: copilotHome },
        );
        assert.equal(install.code, 0, install.stderr);
        await writeFamilyFixture(copilotHome);

        for (const sessionId of [ROOT_ID, CHILD_ID]) {
            const capturePath = path.join(copilotHome, `${sessionId}.json`);
            const provider = await runProvider(copilotHome, sessionId, capturePath);
            assert.equal(provider.code, 0, provider.stderr);
            assert.equal(provider.stdout, "");

            const capture = JSON.parse(await readFile(capturePath, "utf8"));
            assert.equal(capture.error, undefined);
            assert.deepEqual(capture.canvas, {
                id: "chat-fork-map",
                displayName: "Conversation Fork Map",
                actionNames: [
                    "refresh_map",
                    "fork_from_turn",
                ],
            });
            assert.deepEqual(capture.openRequest, {
                canvasId: "chat-fork-map",
                instanceId: "chat-fork-map-current",
            });
            assert.equal(capture.state.kind, "ready", capture.state.message);
            assert.equal(capture.state.currentSessionId, sessionId);
            assert.equal(capture.state.family.rootSessionId, ROOT_ID);
            assert.equal(capture.state.lanes.length, 2);
        }
    } finally {
        await rm(copilotHome, { recursive: true, force: true });
    }
});

test("completes the packaged first fork and reopens from its child", async () => {
    const copilotHome = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-map-first-fork-"),
    );
    try {
        const install = await runProcess(
            "pwsh",
            ["-NoLogo", "-NoProfile", "-File", installScript],
            { COPILOT_HOME: copilotHome },
        );
        assert.equal(install.code, 0, install.stderr);
        await writeRootFixture(copilotHome);

        const rootCapturePath = path.join(copilotHome, "first-fork.json");
        const rootProvider = await runProvider(
            copilotHome,
            ROOT_ID,
            rootCapturePath,
            {
                TEST_SCENARIO: "fork",
                TEST_CHILD_SESSION_ID: CHILD_ID,
            },
        );
        assert.equal(rootProvider.code, 0, rootProvider.stderr);
        assert.equal(rootProvider.stdout, "");
        const rootCapture = JSON.parse(
            await readFile(rootCapturePath, "utf8"),
        );
        assert.equal(rootCapture.state.kind, "ready");
        assert.equal(rootCapture.state.lanes.length, 1);
        assert.deepEqual(rootCapture.forkResult, {
            kind: "created",
            childSessionId: CHILD_ID,
            name: "Shared prompt · Branch 1",
        });
        assert.equal(rootCapture.stateAfterFork.kind, "ready");
        assert.equal(rootCapture.stateAfterFork.lanes.length, 2);

        const childCapturePath = path.join(copilotHome, "child-reopen.json");
        const childProvider = await runProvider(
            copilotHome,
            CHILD_ID,
            childCapturePath,
        );
        assert.equal(childProvider.code, 0, childProvider.stderr);
        assert.equal(childProvider.stdout, "");
        const childCapture = JSON.parse(
            await readFile(childCapturePath, "utf8"),
        );
        assert.equal(childCapture.state.kind, "ready");
        assert.equal(childCapture.state.currentSessionId, CHILD_ID);
        assert.equal(childCapture.state.family.rootSessionId, ROOT_ID);
        assert.equal(childCapture.state.lanes.length, 2);
    } finally {
        await rm(copilotHome, { recursive: true, force: true });
    }
});

test("reports missing Canvas capabilities before asking the host to open", async () => {
    const copilotHome = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-map-canvas-guard-"),
    );
    try {
        const install = await runProcess(
            "pwsh",
            ["-NoLogo", "-NoProfile", "-File", installScript],
            { COPILOT_HOME: copilotHome },
        );
        assert.equal(install.code, 0, install.stderr);
        const capturePath = path.join(copilotHome, "unsupported.json");
        const provider = await runProvider(
            copilotHome,
            ROOT_ID,
            capturePath,
            {
                TEST_CANVAS_RENDERER: "missing",
                TEST_CANVAS_OPEN: "missing",
            },
        );

        assert.equal(provider.code, 1);
        assert.equal(provider.stdout, "");
        const capture = JSON.parse(await readFile(capturePath, "utf8"));
        assert.match(
            capture.error,
            /requires Copilot 1\.0\.80\+ with Canvas renderer, canvas\.open\./,
        );
        assert.doesNotMatch(capture.error, /Cannot read properties/);
    } finally {
        await rm(copilotHome, { recursive: true, force: true });
    }
});

async function writeFamilyFixture(copilotHome) {
    const sessionState = path.join(copilotHome, "session-state");
    const artifacts = path.join(
        copilotHome,
        "extensions",
        "chat-fork-map",
        "artifacts",
    );
    await Promise.all([
        mkdir(path.join(sessionState, ROOT_ID), { recursive: true }),
        mkdir(path.join(sessionState, CHILD_ID), { recursive: true }),
        mkdir(artifacts, { recursive: true }),
    ]);
    const rootEvents = [
        event(SOURCE_USER_ID, "user.message", {
            content: "Shared prompt",
            source: "user",
        }),
        event(SOURCE_ASSISTANT_ID, "assistant.message", {
            content: "Shared answer",
        }),
        event("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "assistant.turn_end", {}),
    ];
    const childEvents = [
        ...rootEvents,
        event(CHILD_MARKER_ID, "session.info", {
            infoType: "fork",
            message: "Forked session",
        }),
        event("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "user.message", {
            content: "Child prompt",
            source: "user",
        }),
        event("ffffffff-ffff-4fff-8fff-ffffffffffff", "assistant.message", {
            content: "Child answer",
        }),
        event("99999999-9999-4999-8999-999999999999", "assistant.turn_end", {}),
    ];
    await Promise.all([
        writeFile(
            path.join(sessionState, ROOT_ID, "events.jsonl"),
            `${rootEvents.map(JSON.stringify).join("\n")}\n`,
            "utf8",
        ),
        writeFile(
            path.join(sessionState, CHILD_ID, "events.jsonl"),
            `${childEvents.map(JSON.stringify).join("\n")}\n`,
            "utf8",
        ),
        writeFile(
            path.join(artifacts, "lineage-v1.json"),
            JSON.stringify(lineageFixture()),
            "utf8",
        ),
    ]);
}

async function writeRootFixture(copilotHome) {
    const rootDirectory = path.join(copilotHome, "session-state", ROOT_ID);
    await mkdir(rootDirectory, { recursive: true });
    const rootEvents = [
        event(SOURCE_USER_ID, "user.message", {
            content: "Shared prompt",
            source: "user",
        }),
        event(SOURCE_ASSISTANT_ID, "assistant.message", {
            content: "Shared answer",
        }),
        event("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "assistant.turn_end", {}),
    ];
    await writeFile(
        path.join(rootDirectory, "events.jsonl"),
        `${rootEvents.map(JSON.stringify).join("\n")}\n`,
        "utf8",
    );
}

function lineageFixture() {
    return {
        version: 1,
        revision: 1,
        families: {
            [ROOT_ID]: {
                familyId: ROOT_ID,
                rootSessionId: ROOT_ID,
                createdAt: "2026-08-25T00:00:00.000Z",
                members: {
                    [ROOT_ID]: {
                        sessionId: ROOT_ID,
                        parentSessionId: null,
                        sourceUserEventId: null,
                        sourceAssistantEventId: null,
                        toEventId: null,
                        childForkMarkerEventId: null,
                        siblingOrdinal: 0,
                        createdAt: "2026-08-25T00:00:00.000Z",
                    },
                    [CHILD_ID]: {
                        sessionId: CHILD_ID,
                        parentSessionId: ROOT_ID,
                        sourceUserEventId: SOURCE_USER_ID,
                        sourceAssistantEventId: SOURCE_ASSISTANT_ID,
                        toEventId: null,
                        childForkMarkerEventId: CHILD_MARKER_ID,
                        siblingOrdinal: 1,
                        createdAt: "2026-08-25T00:01:00.000Z",
                    },
                },
                hiddenSessionIds: [],
            },
        },
        sessionToFamily: {
            [ROOT_ID]: ROOT_ID,
            [CHILD_ID]: ROOT_ID,
        },
    };
}

function event(id, type, data) {
    return { id, type, data };
}

function runProvider(
    copilotHome,
    sessionId,
    capturePath,
    additionalEnv = {},
) {
    return runProcess(
        process.execPath,
        [
            "--no-warnings",
            "--experimental-loader",
            pathToFileURL(sdkLoader).href,
            "--eval",
            "import(process.argv[1])",
            pathToFileURL(
                path.join(
                    copilotHome,
                    "extensions",
                    "chat-fork-map",
                    "extension.mjs",
                ),
            ).href,
        ],
        {
            COPILOT_HOME: copilotHome,
            TEST_SESSION_ID: sessionId,
            TEST_FAMILY_SESSION_IDS: JSON.stringify([ROOT_ID, CHILD_ID]),
            TEST_CAPTURE_PATH: capturePath,
            ...additionalEnv,
        },
    );
}
