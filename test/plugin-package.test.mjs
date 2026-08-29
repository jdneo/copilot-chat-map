import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const packagedExtension = path.join(
    repositoryRoot,
    "com.github.copilot",
    "extensions",
    "chat-fork-map",
);
const agentPluginFields = new Set([
    "$schema",
    "name",
    "version",
    "description",
    "author",
    "homepage",
    "repository",
    "license",
    "keywords",
    "extensions",
]);

async function readJson(...segments) {
    return JSON.parse(
        await readFile(path.join(repositoryRoot, ...segments), "utf8"),
    );
}

test("packages the Canvas as an Agent Plugins v1 client extension", async () => {
    const plugin = await readJson("plugin.json");
    const directManifest = await readJson("copilot-extension.json");
    const packagedManifest = await readJson(
        "com.github.copilot",
        "extensions",
        "chat-fork-map",
        "copilot-extension.json",
    );

    assert.equal(
        plugin.$schema,
        "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    );
    assert.equal(plugin.name, "chat-fork-map");
    assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
    assert.deepEqual(
        Object.keys(plugin).filter((field) => !agentPluginFields.has(field)),
        [],
    );
    assert.deepEqual(plugin.extensions, {
        "com.github.copilot": {
            logo: "assets/preview.png",
        },
    });
    assert.deepEqual(directManifest, packagedManifest);
    await access(path.join(packagedExtension, "extension.mjs"));
    await access(
        path.join(
            repositoryRoot,
            plugin.extensions["com.github.copilot"].logo,
        ),
    );
    await assert.rejects(
        access(
            path.join(
                repositoryRoot,
                ".github",
                "plugin",
                "plugin.json",
            ),
        ),
    );

    const directEntry = await readFile(
        path.join(repositoryRoot, "extension.mjs"),
        "utf8",
    );
    assert.match(
        directEntry,
        /\.\/com\.github\.copilot\/extensions\/chat-fork-map\/extension\.mjs/,
    );

    const intakeEntry = await readFile(
        path.join(
            repositoryRoot,
            "extensions",
            "chat-fork-map",
            "extension.mjs",
        ),
        "utf8",
    );
    assert.match(
        intakeEntry,
        /\.\.\/\.\.\/com\.github\.copilot\/extensions\/chat-fork-map\/extension\.mjs/,
    );
});
