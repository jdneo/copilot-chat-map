import assert from "node:assert/strict";
import {
    access,
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runProcess } from "./fixtures/run-process.mjs";

const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const installScript = path.join(
    repositoryRoot,
    "scripts",
    "install-user-extension.ps1",
);

test("replaces managed user extension files without touching native sessions", async () => {
    const copilotHome = await mkdtemp(
        path.join(os.tmpdir(), "chat-fork-map-install-"),
    );
    const destination = path.join(
        copilotHome,
        "extensions",
        "chat-fork-map",
    );
    const nativeEventLog = path.join(
        copilotHome,
        "session-state",
        "11111111-1111-4111-8111-111111111111",
        "events.jsonl",
    );
    const lineagePath = path.join(
        destination,
        "artifacts",
        "lineage-v1.json",
    );

    try {
        await mkdir(path.dirname(nativeEventLog), { recursive: true });
        await mkdir(path.join(destination, "artifacts", "transcripts"), {
            recursive: true,
        });
        await mkdir(path.join(destination, "legacy-code"), {
            recursive: true,
        });
        await writeFile(nativeEventLog, '{"native":true}\n', "utf8");
        await writeFile(path.join(destination, "obsolete.mjs"), "old", "utf8");
        await writeFile(path.join(destination, "storage.mjs"), "old", "utf8");
        await writeFile(
            path.join(destination, "legacy-code", "index.mjs"),
            "old",
            "utf8",
        );
        await writeFile(
            path.join(destination, "artifacts", "fork-graph.json"),
            "{}",
            "utf8",
        );
        await writeFile(
            path.join(destination, "artifacts", "transcripts", "old.json"),
            "{}",
            "utf8",
        );
        await writeFile(lineagePath, '{"version":1,"revision":7}', "utf8");

        const result = await runProcess(
            "pwsh",
            ["-NoLogo", "-NoProfile", "-File", installScript],
            { COPILOT_HOME: copilotHome },
        );
        assert.equal(result.code, 0, result.stderr);

        await assert.rejects(access(path.join(destination, "obsolete.mjs")));
        await assert.rejects(access(path.join(destination, "storage.mjs")));
        await assert.rejects(access(path.join(destination, "legacy-code")));
        await assert.rejects(
            access(path.join(destination, "artifacts", "fork-graph.json")),
        );
        await assert.rejects(
            access(path.join(destination, "artifacts", "transcripts")),
        );
        assert.equal(
            await readFile(lineagePath, "utf8"),
            '{"version":1,"revision":7}',
        );
        assert.equal(await readFile(nativeEventLog, "utf8"), '{"native":true}\n');
        assert.match(
            await readFile(path.join(destination, "extension.mjs"), "utf8"),
            /createCanvas/,
        );
        const sourceFiles = await readdir(
            path.join(repositoryRoot, "extension"),
        );
        for (const fileName of sourceFiles) {
            assert.deepEqual(
                await readFile(path.join(destination, fileName)),
                await readFile(
                    path.join(repositoryRoot, "extension", fileName),
                ),
            );
        }
    } finally {
        await rm(copilotHome, { recursive: true, force: true });
    }
});
