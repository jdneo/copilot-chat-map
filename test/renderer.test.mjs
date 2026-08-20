import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import { renderHtml } from "../extension/renderer.mjs";

test("renders selectable checkpoint controls and the fork API workflow", () => {
    const html = renderHtml();

    assert.match(html, /"\+ New branch"/);
    assert.match(html, /\/api\/fork/);
    assert.match(html, /crypto\.randomUUID\(\)/);
    assert.match(html, /state\.canFork/);
    assert.match(html, /Open it manually from the session list/);

    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
    assert.ok(script);
    assert.doesNotThrow(() => new vm.Script(script));
});

test("renders family lanes with explicit chat and checkpoint navigation", () => {
    const html = renderHtml();

    assert.match(html, /state\.lanes/);
    assert.match(html, /"Current Session"/);
    assert.match(html, /"Open Chat"/);
    assert.match(html, /\/api\/open-session/);
    assert.match(html, /Fork Checkpoint/);
    assert.match(html, /scrollIntoView/);
    assert.match(html, /article\.dataset\.turnId = turn\.id/);
    assert.doesNotMatch(
        html,
        /article\.addEventListener\("click",\s*\(\)\s*=>\s*openChat/,
    );
});
