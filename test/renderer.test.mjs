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
