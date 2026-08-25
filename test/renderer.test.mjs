import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import { renderHtml } from "../extension/renderer.mjs";

test("renders selectable checkpoint controls and the fork API workflow", () => {
    const html = renderHtml();

    assert.match(html, /"\+ Fork"/);
    assert.match(html, /\/api\/fork/);
    assert.match(html, /new EventSource/);
    assert.match(html, /\/api\/events/);
    assert.match(html, /crypto\.randomUUID\(\)/);
    assert.match(html, /state\.canFork/);
    assert.match(html, /Open it manually from the session list/);
    assert.doesNotMatch(html, /<header>/);
    assert.doesNotMatch(html, /<h1>Conversation Fork Map<\/h1>/);
    assert.match(
        html,
        /<button id="refresh"[^>]+aria-label="Refresh"[^>]+title="Refresh"/,
    );
    assert.match(
        html,
        /<nav class="map-controls"[\s\S]*?<button id="refresh"[\s\S]*?<\/nav>/,
    );
    assert.match(html, /<svg[^>]+aria-hidden="true"/);
    assert.match(html, /#refresh \{[\s\S]+background: #1f6feb;/);
    assert.match(html, /#refresh svg \{[\s\S]+stroke: #fff;/);
    assert.match(html, /\.minimap \{[\s\S]*?bottom: 16px;/);
    assert.match(html, /#notice \{[\s\S]+position: fixed;/);

    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
    assert.ok(script);
    assert.doesNotThrow(() => new vm.Script(script));
});

test("renders family lanes with explicit chat and checkpoint navigation", () => {
    const html = renderHtml();

    assert.match(html, /state\.lanes/);
    assert.doesNotMatch(html, /"Current Session"/);
    assert.doesNotMatch(html, /lane-header/);
    assert.doesNotMatch(html, /lane-heading/);
    assert.match(html, /"Open Chat"/);
    assert.match(html, /\/api\/open-session/);
    assert.match(html, /Fork Checkpoint/);
    assert.match(html, /scrollIntoView/);
    assert.match(html, /article\.dataset\.turnId = turn\.id/);
    assert.match(
        html,
        /\.branch-connection \{[\s\S]+stroke: var\(--border-color-default/,
    );
    assert.match(html, /stroke-linejoin: round/);
    assert.match(html, /" Q " \+/);
    assert.doesNotMatch(
        html,
        /article\.addEventListener\("click",\s*\(\)\s*=>\s*openChat/,
    );
});

test("keeps a zoomed large family scrollable and recoverable", () => {
    const html = renderHtml();

    assert.match(
        html,
        /\.map-viewport \{[\s\S]*?overflow: auto;[\s\S]*?cursor: grab;/,
    );
    assert.match(
        html,
        /\.map-stage \{[\s\S]*?min-width: 100%;[\s\S]*?min-height: 100%;/,
    );
    assert.match(html, /id="zoom-out"[^>]+aria-label="Zoom out"/);
    assert.match(html, /id="zoom-in"[^>]+aria-label="Zoom in"/);
    assert.match(html, />Fit all<\/button>/);
    assert.match(html, />Focus current<\/button>/);
    assert.match(html, /family\.style\.transform = "scale\(" \+ view\.scale \+ "\)"/);
    assert.match(html, /viewport\.addEventListener\("pointerdown"/);
});

test("pans from empty canvas drag without taking over Turn Node gestures", async () => {
    const html = renderHtml();
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
    assert.ok(script);

    const sessionId = "11111111-1111-4111-8111-111111111111";
    const turn = {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        userContent: "Selectable text",
        assistantContent: "Response",
        status: "completed",
    };
    const document = fakeDocument();
    const context = browserContext(
        document,
        readyState(sessionId, [lane(sessionId, true, [turn])]),
    );
    new vm.Script(script).runInContext(vm.createContext(context));
    await settle();

    const viewport = document.querySelector(".map-viewport");
    viewport.scrollLeft = 100;
    viewport.scrollTop = 80;
    viewport.dispatchEvent(pointerEvent("pointerdown", viewport, 60, 50));
    viewport.dispatchEvent(pointerEvent("pointermove", viewport, 20, 10));
    viewport.dispatchEvent(pointerEvent("pointerup", viewport, 20, 10));
    assert.equal(viewport.scrollLeft, 140);
    assert.equal(viewport.scrollTop, 120);
    viewport.dispatchEvent({ type: "scroll", target: viewport });
    const minimapViewport = document.querySelector(".minimap-viewport");
    assert.notEqual(minimapViewport.x, "NaN");
    assert.notEqual(minimapViewport.y, "NaN");

    const article = document.querySelector(".turn");
    viewport.dispatchEvent(pointerEvent("pointerdown", article, 20, 10));
    viewport.dispatchEvent(pointerEvent("pointermove", article, 0, 0));
    assert.equal(viewport.scrollLeft, 140);
    assert.equal(viewport.scrollTop, 120);
});

test("keeps connector coordinates aligned when the family is zoomed", async () => {
    const html = renderHtml();
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
    assert.ok(script);

    const rootId = "11111111-1111-4111-8111-111111111111";
    const childId = "22222222-2222-4222-8222-222222222222";
    const turn = {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        userContent: "Source",
        assistantContent: "Response",
        status: "completed",
    };
    const document = fakeDocument();
    const context = browserContext(
        document,
        readyState(rootId, [
            lane(rootId, true, [turn]),
            lane(childId, false, []),
        ]),
    );
    new vm.Script(script).runInContext(vm.createContext(context));
    await settle();

    const family = document.querySelector(".family");
    const source = document.querySelector(".turn.completed");
    const target = document.querySelector(".branch-entry");
    family.getBoundingClientRect = () => rect(0, 0, 960, 720);
    source.getBoundingClientRect = () => rect(0, 120, 408, 144);
    target.getBoundingClientRect = () => rect(466, 240, 408, 110);

    document.querySelector("#zoom-in").click();

    const bus = document.querySelector(".branch-bus");
    assert.equal(Number(bus.x1), 340);
});

test("Fit all can frame a family wider than the interactive zoom range", async () => {
    const html = renderHtml();
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
    assert.ok(script);

    const sessionId = "11111111-1111-4111-8111-111111111111";
    const document = fakeDocument();
    const context = browserContext(
        document,
        readyState(sessionId, [lane(sessionId, true, [])]),
    );
    new vm.Script(script).runInContext(vm.createContext(context));
    await settle();

    const viewport = document.querySelector(".map-viewport");
    const family = document.querySelector(".family");
    viewport.clientWidth = 800;
    viewport.clientHeight = 600;
    family.scrollWidth = 40_000;
    family.scrollHeight = 1_000;
    document.querySelector("#fit-all").click();

    assert.equal(document.querySelector("#zoom-level").textContent, "2%");
});

test("collapses and restores descendants while the minimap keeps map state", async () => {
    const html = renderHtml();
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
    assert.ok(script);

    const rootId = "11111111-1111-4111-8111-111111111111";
    const childId = "22222222-2222-4222-8222-222222222222";
    const grandchildId = "33333333-3333-4333-8333-333333333333";
    const rootTurn = {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        userContent: "Root turn",
        assistantContent: "Root response",
        status: "completed",
    };
    const childTurn = {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        userContent: "Child turn",
        assistantContent: "Child response",
        status: "completed",
    };
    const lanes = [
        lane(rootId, true, [rootTurn]),
        lane(childId, false, [childTurn]),
        {
            ...lane(grandchildId, false, []),
            parentSessionId: childId,
            sourceCheckpoint: {
                sessionId: childId,
                turnId: childTurn.id,
                available: true,
            },
        },
    ];
    const document = fakeDocument();
    const context = browserContext(document, readyState(rootId, lanes));
    new vm.Script(script).runInContext(vm.createContext(context));
    await settle();

    assert.equal(document.querySelectorAll(".lane").length, 3);
    assert.equal(document.querySelectorAll(".minimap-lane").length, 3);
    assert.equal(document.querySelectorAll(".minimap-lane.current").length, 1);
    assert.ok(document.querySelector(".minimap-viewport"));

    const rootLane = document
        .querySelectorAll(".lane")
        .find((candidate) => candidate.dataset.sessionId === rootId);
    const collapse = rootLane.querySelector(".subtree-toggle");
    assert.equal(collapse.textContent, "Collapse subtree");
    collapse.click();

    assert.equal(document.querySelectorAll(".lane").length, 1);
    assert.equal(document.querySelectorAll(".minimap-lane").length, 3);
    assert.equal(document.querySelectorAll(".minimap-lane.collapsed").length, 2);
    const expand = document.querySelector(".subtree-toggle");
    assert.equal(expand.textContent, "Expand subtree");
    expand.click();

    assert.deepEqual(
        document.querySelectorAll(".lane").map((candidate) => candidate.dataset.sessionId),
        [rootId, childId, grandchildId],
    );
    document.querySelector(".turn").click();
    assert.ok(document.querySelector(".minimap-selection"));
});

test("Focus current reopens a collapsed path to the Current Session", async () => {
    const html = renderHtml();
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
    assert.ok(script);

    const rootId = "11111111-1111-4111-8111-111111111111";
    const childId = "22222222-2222-4222-8222-222222222222";
    const rootTurn = {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        userContent: "Root turn",
        assistantContent: "Root response",
        status: "completed",
    };
    const rootLane = {
        ...lane(rootId, false, [rootTurn]),
        parentSessionId: null,
        sourceCheckpoint: null,
    };
    const childLane = {
        ...lane(childId, true, []),
        parentSessionId: rootId,
        sourceCheckpoint: {
            sessionId: rootId,
            turnId: rootTurn.id,
            available: true,
        },
    };
    const document = fakeDocument();
    const context = browserContext(
        document,
        readyState(childId, [rootLane, childLane]),
    );
    new vm.Script(script).runInContext(vm.createContext(context));
    await settle();

    document
        .querySelectorAll(".lane")
        .find((candidate) => candidate.dataset.sessionId === rootId)
        .querySelector(".subtree-toggle")
        .click();
    assert.equal(document.querySelectorAll(".lane").length, 1);

    document.querySelector("#focus-current").click();

    assert.equal(document.querySelectorAll(".lane").length, 2);
    assert.equal(document.querySelector(".lane.current").scrollIntoViewCount, 1);
});

test("keeps rich DOM bounded for a 50-session 5,000-turn family", async () => {
    const html = renderHtml();
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
    assert.ok(script);

    const rootId = "11111111-1111-4111-8111-111111111111";
    const turns = Array.from({ length: 100 }, (_, index) => ({
        id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`,
        userContent: `Prompt ${index}\nDetail one\nDetail two\nDetail three`,
        assistantContent: `Response ${index}`,
        status: "completed",
    }));
    const lanes = Array.from({ length: 50 }, (_, index) =>
        lane(
            index === 0
                ? rootId
                : `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`,
            index === 0,
            turns,
        ),
    );
    const document = fakeDocument();
    const observers = [];
    const context = browserContext(document, readyState(rootId, lanes));
    context.IntersectionObserver = class {
        constructor(callback) {
            this.callback = callback;
            this.targets = [];
            observers.push(this);
        }

        observe(target) {
            this.targets.push(target);
        }

        disconnect() {}

        reveal(count) {
            this.callback(
                this.targets
                    .slice(0, count)
                    .map((target) => ({ target, isIntersecting: true })),
            );
        }
    };
    new vm.Script(script).runInContext(vm.createContext(context));
    await settle();

    assert.equal(document.querySelectorAll(".turn").length, 5_000);
    assert.equal(document.querySelectorAll(".turn-body").length, 0);
    assert.equal(observers.length, 1);
    assert.equal(observers[0].targets.length, 5_000);

    observers[0].reveal(8);

    assert.equal(document.querySelectorAll(".turn-body").length, 8);
    const firstTurn = document.querySelector(".turn");
    firstTurn.click();
    firstTurn.querySelector(".message-toggle").click();
    assert.equal(firstTurn["aria-selected"], "true");
    assert.equal(
        firstTurn.querySelector(".message-toggle").textContent,
        "Collapse",
    );

    const viewport = document.querySelector(".map-viewport");
    viewport.dispatchEvent(pointerEvent("pointerdown", viewport, 80, 60));
    viewport.dispatchEvent(pointerEvent("pointermove", viewport, 30, 20));
    viewport.dispatchEvent(pointerEvent("pointerup", viewport, 30, 20));
    assert.equal(viewport.scrollLeft, 50);
    assert.equal(viewport.scrollTop, 40);
    document.querySelector("#zoom-in").click();
    assert.equal(document.querySelector("#zoom-level").textContent, "120%");
    document.querySelector("#fit-all").click();
    const currentLane = document.querySelector(".lane.current");
    const focusCount = currentLane.scrollIntoViewCount;
    document.querySelector("#focus-current").click();
    assert.equal(currentLane.scrollIntoViewCount, focusCount + 1);

    document.querySelector(".subtree-toggle").click();
    assert.equal(document.querySelectorAll(".lane").length, 1);
    document.querySelector(".subtree-toggle").click();
    assert.equal(document.querySelectorAll(".lane").length, 50);
    assert.ok(document.querySelector(".minimap-selection"));
});

test("restores expanded content after an off-screen turn is virtualized", async () => {
    const html = renderHtml();
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
    assert.ok(script);

    const sessionId = "11111111-1111-4111-8111-111111111111";
    const turn = {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        userContent: "One\nTwo\nThree\nFour",
        assistantContent: "Done.",
        status: "completed",
    };
    const document = fakeDocument();
    let observer;
    const context = browserContext(
        document,
        readyState(sessionId, [lane(sessionId, true, [turn])]),
    );
    context.IntersectionObserver = class {
        constructor(callback) {
            this.callback = callback;
            this.targets = [];
            observer = this;
        }

        observe(target) {
            this.targets.push(target);
        }

        disconnect() {}

        setVisible(target, isIntersecting) {
            this.callback([{ target, isIntersecting }]);
        }
    };
    new vm.Script(script).runInContext(vm.createContext(context));
    await settle();

    const article = document.querySelector(".turn");
    observer.setVisible(article, true);
    const toggle = article.querySelector(".message-toggle");
    toggle.click();
    assert.equal(toggle.textContent, "Collapse");

    observer.setVisible(article, false);
    assert.equal(article.querySelector(".turn-body"), null);
    observer.setVisible(article, true);

    const restoredToggle = article.querySelector(".message-toggle");
    assert.equal(restoredToggle.textContent, "Collapse");
    assert.equal(restoredToggle["aria-expanded"], "true");
    assert.equal(restoredToggle.hidden, false);
});

test("unmounts a previous selection after it moves off-screen", async () => {
    const html = renderHtml();
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
    assert.ok(script);

    const sessionId = "11111111-1111-4111-8111-111111111111";
    const turns = ["first", "second"].map((name, index) => ({
        id: `${index + 1}aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
        userContent: name,
        assistantContent: `${name} response`,
        status: "completed",
    }));
    const document = fakeDocument();
    let observer;
    const context = browserContext(
        document,
        readyState(sessionId, [lane(sessionId, true, turns)]),
    );
    context.IntersectionObserver = class {
        constructor(callback) {
            this.callback = callback;
            this.targets = [];
            observer = this;
        }

        observe(target) {
            this.targets.push(target);
        }

        disconnect() {}

        setVisible(target, isIntersecting) {
            this.callback([{ target, isIntersecting }]);
        }
    };
    new vm.Script(script).runInContext(vm.createContext(context));
    await settle();

    const [first, second] = document.querySelectorAll(".turn");
    observer.setVisible(first, true);
    first.click();
    observer.setVisible(first, false);
    assert.ok(first.querySelector(".turn-body"));

    observer.setVisible(second, true);
    second.click();

    assert.equal(first.querySelector(".turn-body"), null);
    assert.ok(second.querySelector(".turn-body"));
});

test("reuses unchanged lane DOM when one branch updates", async () => {
    const html = renderHtml();
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
    assert.ok(script);

    const rootId = "11111111-1111-4111-8111-111111111111";
    const childId = "22222222-2222-4222-8222-222222222222";
    const rootTurn = {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        userContent: "Stable root",
        assistantContent: "Unchanged",
        status: "completed",
    };
    const childTurn = {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        userContent: "Existing child",
        assistantContent: "Existing response",
        status: "completed",
    };
    const appendedTurn = {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        userContent: "Appended child turn",
        assistantContent: "New response",
        status: "completed",
    };
    const states = [
        readyState(rootId, [
            lane(rootId, true, [rootTurn]),
            lane(childId, false, [childTurn]),
        ]),
        readyState(rootId, [
            lane(rootId, true, [rootTurn]),
            lane(childId, false, [childTurn, appendedTurn]),
        ]),
    ];
    const document = fakeDocument();
    let requestCount = 0;
    const context = browserContext(document, states[0]);
    context.fetch = async (url) => {
        if (url.startsWith("/api/state")) {
            return jsonResponse(states[Math.min(requestCount++, states.length - 1)]);
        }
        throw new Error(`Unexpected request: ${url}`);
    };
    new vm.Script(script).runInContext(vm.createContext(context));
    await settle();

    const before = document.querySelectorAll(".lane");
    document.querySelector("#refresh").click();
    await settle();
    const after = document.querySelectorAll(".lane");

    assert.equal(after[0], before[0]);
    assert.notEqual(after[1], before[1]);
    assert.equal(after[1].querySelectorAll(".turn").length, 2);
});

test("defaults a large non-current subtree to collapsed without hiding its root", async () => {
    const html = renderHtml();
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
    assert.ok(script);

    const rootId = "11111111-1111-4111-8111-111111111111";
    const branchId = "22222222-2222-4222-8222-222222222222";
    const grandchildId = "33333333-3333-4333-8333-333333333333";
    const rootTurn = {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        userContent: "Root turn",
        assistantContent: "Root response",
        status: "completed",
    };
    const branchTurn = {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        userContent: "Branch turn",
        assistantContent: "Branch response",
        status: "completed",
    };
    const lanes = [
        lane(rootId, true, [rootTurn]),
        lane(branchId, false, [branchTurn]),
        {
            ...lane(grandchildId, false, []),
            parentSessionId: branchId,
            sourceCheckpoint: {
                sessionId: branchId,
                turnId: branchTurn.id,
                available: true,
            },
        },
        ...Array.from({ length: 18 }, (_, index) =>
            lane(
                `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
                false,
                [],
            ),
        ),
    ];
    const document = fakeDocument();
    const context = browserContext(document, readyState(rootId, lanes));
    new vm.Script(script).runInContext(vm.createContext(context));
    await settle();

    assert.equal(document.querySelectorAll(".lane").length, 20);
    const branch = document
        .querySelectorAll(".lane")
        .find((candidate) => candidate.dataset.sessionId === branchId);
    assert.ok(branch);
    assert.equal(
        branch.querySelector(".subtree-toggle").textContent,
        "Expand subtree",
    );
    assert.equal(
        document
            .querySelectorAll(".lane")
            .some((candidate) => candidate.dataset.sessionId === grandchildId),
        false,
    );
});

test("dismisses an Open Chat error notice", async () => {
    const html = renderHtml();
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
    assert.ok(script);

    const parentId = "11111111-1111-4111-8111-111111111111";
    const childId = "22222222-2222-4222-8222-222222222222";
    const document = fakeDocument();
    const state = readyState(parentId, [
        lane(parentId, true, []),
        lane(childId, false, []),
    ]);
    const context = browserContext(document, state);
    context.fetch = async (url) => {
        if (url.startsWith("/api/state")) return jsonResponse(state);
        if (url.startsWith("/api/open-session")) {
            return jsonResponse({
                kind: "navigation_failed",
                message: "Open this session manually.",
            });
        }
        throw new Error(`Unexpected request: ${url}`);
    };
    new vm.Script(script).runInContext(vm.createContext(context));
    await settle();

    document.querySelector(".open-chat").click();
    await settle();

    const notice = document.querySelector("#notice");
    assert.equal(notice.hidden, false);
    const closeButton = notice.querySelector(".notice-close");
    assert.ok(closeButton);

    closeButton.click();

    assert.equal(notice.hidden, true);
});

test("removes virtual-node information once a child lane has turns", async () => {
    const html = renderHtml();
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
    assert.ok(script);

    const parentId = "11111111-1111-4111-8111-111111111111";
    const childId = "22222222-2222-4222-8222-222222222222";
    const childTurn = {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        userContent: "Continue in the child",
        assistantContent: "Child reply.",
        status: "completed",
    };
    const document = fakeDocument();
    const context = browserContext(
        document,
        readyState(parentId, [
            lane(parentId, true, []),
            lane(childId, false, [childTurn]),
        ]),
    );
    new vm.Script(script).runInContext(vm.createContext(context));
    await settle();

    const childLane = document
        .querySelectorAll(".lane")
        .find((candidate) => candidate.dataset.sessionId === childId);
    const branchEntry = childLane.querySelector(".branch-entry");
    assert.ok(branchEntry);
    assert.equal(branchEntry.childElementCount, 0);
    assert.equal(childLane.querySelector(".turn.virtual"), null);
    assert.equal(childLane.querySelector(".checkpoint-link"), null);
    assert.equal(childLane.querySelector(".open-chat"), null);
});

test("refreshes the family after a branch is created", async () => {
    const html = renderHtml();
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
    assert.ok(script);

    const parentId = "11111111-1111-4111-8111-111111111111";
    const childId = "22222222-2222-4222-8222-222222222222";
    const siblingId = "33333333-3333-4333-8333-333333333333";
    const turn = {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        userContent: "Create a child",
        assistantContent: "Ready.",
        status: "completed",
    };
    const childTurn = {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        userContent: "Continue in the child",
        assistantContent: "Child reply.",
        status: "completed",
    };
    const document = fakeDocument();
    let stateRequests = 0;
    const states = [
        readyState(parentId, [
            lane(parentId, true, [turn]),
        ]),
        readyState(parentId, [
            lane(parentId, true, [turn]),
            lane(childId, false, []),
            lane(siblingId, false, []),
        ]),
        readyState(parentId, [
            lane(parentId, true, [turn]),
            lane(childId, false, [childTurn]),
            lane(siblingId, false, []),
        ]),
    ];
    const context = vm.createContext({
        console,
        crypto: { randomUUID: () => "operation-1" },
        document,
        fetch: async (url) => {
            if (url.startsWith("/api/state")) {
                const state = states[Math.min(stateRequests, states.length - 1)];
                stateRequests += 1;
                return jsonResponse(state);
            }
            if (url.startsWith("/api/fork")) {
                return jsonResponse({
                    kind: "created",
                    childSessionId: childId,
                    name: "Create a child · Branch 1",
                    navigation: "requested",
                });
            }
            throw new Error(`Unexpected request: ${url}`);
        },
        requestAnimationFrame: (callback) => callback(),
        setInterval: () => 0,
        setTimeout: () => 0,
        URLSearchParams,
        window: { location: { search: "?token=<REDACTED>" } },
    });
    new vm.Script(script).runInContext(context);
    await settle();

    document.querySelector(".turn").click();
    document.querySelector(".branch-button").click();
    await settle();

    assert.equal(stateRequests, 2);
    assert.equal(document.querySelectorAll(".lane").length, 3);
    assert.equal(document.querySelectorAll(".branch-entry").length, 2);
    assert.equal(document.querySelectorAll(".turn.virtual").length, 2);
    assert.equal(document.querySelectorAll(".branch-bus").length, 1);
    assert.equal(document.querySelectorAll(".branch-stem").length, 2);
    assert.equal(document.querySelectorAll(".branch-entry.pending").length, 2);
    assert.equal(
        document.querySelectorAll(".branch-stem.pending").length,
        2,
    );
    assert.equal(document.querySelectorAll(".branch-bus.pending").length, 1);
    const bus = document.querySelector(".branch-bus");
    const stemStartXs = document
        .querySelectorAll(".branch-stem")
        .map((stem) => Number(/^M ([\d.-]+)/.exec(stem.d)?.[1]));
    assert.equal(Number(bus.x2), Math.max(...stemStartXs));
    assert.equal(document.querySelectorAll(".state").length, 0);
    assert.equal(
        document
            .querySelectorAll(".lane")
            .find((candidate) => candidate.dataset.sessionId === childId)
            .scrollIntoViewCount,
        1,
    );

    document.querySelector("#refresh").click();
    await settle();

    assert.equal(document.querySelectorAll(".branch-entry.pending").length, 1);
    assert.equal(document.querySelectorAll(".turn.virtual").length, 1);
    assert.equal(
        document.querySelectorAll(".branch-stem.pending").length,
        1,
    );
    assert.equal(document.querySelectorAll(".branch-bus.pending").length, 0);
});

test("forks a completed turn directly from a non-current family lane", async () => {
    const html = renderHtml();
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
    assert.ok(script);

    const parentId = "11111111-1111-4111-8111-111111111111";
    const childId = "22222222-2222-4222-8222-222222222222";
    const childTurn = {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        userContent: "Fork this child turn",
        assistantContent: "Ready.",
        status: "completed",
    };
    const document = fakeDocument();
    const forkRequests = [];
    const context = vm.createContext({
        console,
        crypto: { randomUUID: () => "nested-operation" },
        document,
        fetch: async (url, options = {}) => {
            if (url.startsWith("/api/state")) {
                return jsonResponse(
                    readyState(parentId, [
                        lane(parentId, true, []),
                        lane(childId, false, [childTurn]),
                    ]),
                );
            }
            if (url.startsWith("/api/fork")) {
                forkRequests.push(JSON.parse(options.body));
                return jsonResponse({
                    kind: "created",
                    childSessionId:
                        "33333333-3333-4333-8333-333333333333",
                    name: "Fork this child turn · Branch 1",
                    navigation: "requested",
                });
            }
            throw new Error(`Unexpected request: ${url}`);
        },
        requestAnimationFrame: (callback) => callback(),
        setInterval: () => 0,
        setTimeout: () => 0,
        URLSearchParams,
        window: { location: { search: "?token=<REDACTED>" } },
    });
    new vm.Script(script).runInContext(context);
    await settle();

    const childLane = document
        .querySelectorAll(".lane")
        .find((candidate) => candidate.dataset.sessionId === childId);
    const childForkButton = childLane?.querySelector(".branch-button");
    assert.ok(childForkButton);
    childLane.querySelector(".turn").click();
    assert.equal(childForkButton.scrollIntoViewCount, 1);
    childForkButton.click();
    await settle();

    assert.deepEqual(forkRequests, [
        {
            operationId: "nested-operation",
            sessionId: childId,
            turnId: childTurn.id,
        },
    ]);
});

test("hides an unavailable subtree without changing its lineage", async () => {
    const rootId = "11111111-1111-4111-8111-111111111111";
    const childId = "22222222-2222-4222-8222-222222222222";
    const grandchildId = "33333333-3333-4333-8333-333333333333";
    const sourceTurn = {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        userContent: "Source",
        assistantContent: "Ready.",
        status: "completed",
    };
    const state = readyState(rootId, [
        lane(rootId, true, [sourceTurn]),
        {
            ...lane(childId, false, []),
            session: {
                ...lane(childId, false, []).session,
                available: false,
                inUse: false,
            },
            sourceCheckpoint: {
                sessionId: rootId,
                turnId: sourceTurn.id,
                available: false,
            },
        },
        {
            ...lane(grandchildId, false, []),
            parentSessionId: childId,
            sourceCheckpoint: {
                sessionId: childId,
                turnId: "missing-turn",
                available: false,
            },
        },
    ]);
    state.family.hiddenSessionIds = [];
    const requests = [];
    const document = fakeDocument();
    const context = browserContext(document, state);
    context.fetch = async (url, options = {}) => {
        if (url.startsWith("/api/hidden-subtree")) {
            const request = JSON.parse(options.body);
            requests.push(request);
            state.family.hiddenSessionIds = request.hidden
                ? [request.sessionId]
                : [];
            return jsonResponse({ kind: "updated", ...request });
        }
        if (url.startsWith("/api/state")) return jsonResponse(state);
        throw new Error(`Unexpected request: ${url}`);
    };
    const script = /<script>([\s\S]*)<\/script>/.exec(renderHtml())?.[1];
    new vm.Script(script).runInContext(vm.createContext(context));
    await settle();

    const childLane = document
        .querySelectorAll(".lane")
        .find((candidate) => candidate.dataset.sessionId === childId);
    assert.match(textIn(childLane), /Session unavailable/);
    assert.match(textIn(childLane), /Fork checkpoint unavailable/i);
    childLane.querySelector(".hide-subtree").click();
    await settle();

    assert.deepEqual(requests, [{ sessionId: childId, hidden: true }]);
    assert.deepEqual(
        document
            .querySelectorAll(".lane")
            .map((candidate) => candidate.dataset.sessionId),
        [rootId],
    );
    assert.equal(state.lanes[2].parentSessionId, childId);
});

test("does not offer Fork on an occupied non-current lane", async () => {
    const rootId = "11111111-1111-4111-8111-111111111111";
    const childId = "22222222-2222-4222-8222-222222222222";
    const turn = {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        userContent: "Occupied",
        assistantContent: "Ready.",
        status: "completed",
    };
    const child = lane(childId, false, [turn]);
    child.session.inUse = true;
    const document = fakeDocument();
    const context = browserContext(
        document,
        readyState(rootId, [lane(rootId, true, []), child]),
    );
    const script = /<script>([\s\S]*)<\/script>/.exec(renderHtml())?.[1];
    new vm.Script(script).runInContext(vm.createContext(context));
    await settle();

    const childLane = document
        .querySelectorAll(".lane")
        .find((candidate) => candidate.dataset.sessionId === childId);
    childLane.querySelector(".turn").click();
    assert.equal(childLane.querySelector(".branch-button"), null);
});

test("keeps the Fork control visible beside the rightmost family lane", () => {
    const html = renderHtml();

    assert.match(
        html,
        /\.family \{[\s\S]*?padding: 2px 90px 2px 2px;[\s\S]*?\}/,
    );
    assert.match(
        html,
        /\.branch-button \{[\s\S]*?top: 50%;[\s\S]*?left: calc\(100% \+ 10px\);[\s\S]*?transform: translateY\(-50%\);[\s\S]*?\}/,
    );
    assert.match(
        html,
        /\.message\.assistant \{[\s\S]*?background: var\(--background-color-default, Canvas\);[\s\S]*?color: var\(--text-color-default, CanvasText\);/,
    );
    assert.match(
        html,
        /\.message:last-child \{ border-radius: 0 0 9px 9px; \}/,
    );
    assert.doesNotMatch(html, /\.turn \{[^}]*overflow: hidden;/);
    assert.doesNotMatch(html, /\.lane\.current \{[\s\S]*?drop-shadow/);
});

test("renders independently expandable role bands without execution details", async () => {
    const html = renderHtml();
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
    assert.ok(script);

    const sessionId = "11111111-1111-4111-8111-111111111111";
    const turn = {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        userContent: "First user line\nSecond user line\nThird user line\nFourth user line",
        assistantContent: "Copilot response",
        status: "completed",
        executionDetails: [
            {
                id: "tool-event",
                type: "tool.execution_complete",
                data: { name: "view", result: "Read renderer.mjs" },
            },
        ],
    };
    const document = fakeDocument();
    const context = browserContext(
        document,
        readyState(sessionId, [lane(sessionId, true, [turn])]),
    );
    new vm.Script(script).runInContext(vm.createContext(context));
    await settle();

    const article = document.querySelector(".turn");
    const bands = article.querySelectorAll(".message");
    const toggles = article.querySelectorAll(".message-toggle");
    assert.equal(bands.length, 2);
    assert.equal(bands[0].querySelector(".role"), null);
    assert.equal(bands[1].querySelector(".role"), null);
    assert.equal(bands[0]["aria-label"], "You message");
    assert.equal(bands[1]["aria-label"], "Copilot message");
    assert.equal(
        bands[0]
            .querySelector(".content")
            .style.getPropertyValue("--line-clamp"),
        "3",
    );
    assert.equal(
        bands[1]
            .querySelector(".content")
            .style.getPropertyValue("--line-clamp"),
        "8",
    );
    assert.equal(toggles.length, 2);
    assert.equal(toggles[0].textContent, "Expand");
    assert.equal(toggles[0].hidden, false);
    assert.equal(toggles[1].hidden, true);
    assert.equal(article.querySelectorAll(".execution-details").length, 0);

    toggles[0].click();

    assert.equal(toggles[0].textContent, "Collapse");
    assert.equal(toggles[0]["aria-expanded"], "true");
    assert.equal(toggles[1]["aria-expanded"], "false");
    assert.equal(article.dataset.turnId, turn.id);
    assert.equal(article["aria-selected"], "false");
});

test("renders useful Markdown without activating unsafe content or remote images", async () => {
    const html = renderHtml();
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
    assert.ok(script);

    const sessionId = "11111111-1111-4111-8111-111111111111";
    const markdown = [
        "# Heading",
        "",
        "- one",
        "- two with `code` and **strong text**",
        "",
        "| Name | Value |",
        "| --- | --- |",
        "| safe | [Docs](https://example.com/docs) |",
        "",
        "```js",
        "alert('shown, not run')",
        "```",
        "",
        "<script>globalThis.compromised = true</script>",
        "<img src=x onerror=globalThis.compromised=true>",
        "[Bad](javascript:globalThis.compromised=true)",
        "![Diagram](https://images.example.com/diagram.png)",
        "[malformed](https://example.com",
    ].join("\n");
    const turn = {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        userContent: markdown,
        assistantContent: "Done.",
        status: "completed",
        executionDetails: [],
    };
    const document = fakeDocument();
    const context = browserContext(
        document,
        readyState(sessionId, [lane(sessionId, true, [turn])]),
    );
    new vm.Script(script).runInContext(vm.createContext(context));
    await settle();

    const article = document.querySelector(".turn");
    assert.equal(article.querySelectorAll(".markdown-heading").length, 1);
    assert.equal(article.querySelectorAll(".markdown-list").length, 1);
    assert.equal(article.querySelectorAll(".markdown-table").length, 1);
    assert.equal(article.querySelectorAll(".inline-code").length, 1);
    assert.equal(article.querySelectorAll(".markdown-strong").length, 1);
    assert.equal(
        article.querySelector(".markdown-strong").textContent,
        "strong text",
    );
    assert.equal(article.querySelectorAll(".code-block").length, 1);
    assert.equal(article.querySelectorAll(".markdown-link").length, 1);
    const link = article.querySelector(".markdown-link");
    assert.equal(link.href, "https://example.com/docs");
    assert.equal(link.target, "_blank");
    assert.equal(link.rel, "noopener noreferrer");
    assert.equal(context.compromised, undefined);
    assert.match(textIn(article), /<script>globalThis\.compromised = true<\/script>/);
    assert.match(textIn(article), /<img src=x onerror=globalThis\.compromised=true>/);
    assert.match(textIn(article), /Bad/);
    assert.match(textIn(article), /\[malformed\]\(https:\/\/example\.com/);

    assert.equal(article.querySelectorAll(".remote-image").length, 1);
    const image = article.querySelector(".remote-image");
    const loadImage = article.querySelector(".load-image");
    assert.ok(image);
    assert.equal(image.src, undefined);
    assert.equal(image.alt, "Diagram");

    loadImage.click();

    assert.equal(image.src, "https://images.example.com/diagram.png");
    assert.equal(image.referrerPolicy, "no-referrer");
});

function readyState(currentSessionId, lanes) {
    const currentLane = lanes.find((candidate) => candidate.session.current);
    return {
        kind: "ready",
        canFork: true,
        currentSessionId,
        family: { id: currentSessionId, rootSessionId: currentSessionId },
        session: currentLane.session,
        turns: currentLane.turns,
        lanes,
        updatedAt: "2026-08-20T08:00:00.000Z",
    };
}

function lane(id, current, turns) {
    return {
        session: {
            id,
            title: current ? "Parent" : "Child",
            summary: "",
            modifiedTime: "2026-08-20T08:00:00.000Z",
            available: true,
            inUse: current,
            current,
        },
        parentSessionId: current
            ? null
            : "11111111-1111-4111-8111-111111111111",
        inheritedTurnCount: current ? 0 : 1,
        sourceCheckpoint: current
            ? null
            : {
                  sessionId: "11111111-1111-4111-8111-111111111111",
                  turnId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                  available: true,
              },
        turns,
    };
}

function jsonResponse(value) {
    return {
        ok: true,
        status: 200,
        json: async () => structuredClone(value),
    };
}

function settle() {
    return new Promise((resolve) => setImmediate(resolve));
}

function pointerEvent(type, target, clientX, clientY) {
    return {
        type,
        target,
        button: 0,
        clientX,
        clientY,
        pointerId: 1,
        defaultPrevented: false,
        preventDefault() {
            this.defaultPrevented = true;
        },
    };
}

function browserContext(document, state) {
    return {
        console,
        crypto: { randomUUID: () => "operation-1" },
        document,
        fetch: async (url) => {
            if (url.startsWith("/api/state")) return jsonResponse(state);
            throw new Error(`Unexpected request: ${url}`);
        },
        requestAnimationFrame: (callback) => callback(),
        setInterval: () => 0,
        setTimeout: () => 0,
        URL,
        URLSearchParams,
        window: {
            addEventListener() {},
            location: { search: "?token=<REDACTED>" },
        },
    };
}

function textIn(node) {
    if (!(node instanceof FakeElement)) return String(node);
    return [node.textContent, ...node.children.map(textIn)].join("");
}

function fakeDocument() {
    const roots = new Map([
        ["content", new FakeElement("main")],
        ["refresh", new FakeElement("button")],
        ["status", new FakeElement("p")],
        ["notice", new FakeElement("aside")],
        ["zoom-out", new FakeElement("button")],
        ["zoom-in", new FakeElement("button")],
        ["zoom-level", new FakeElement("span")],
        ["fit-all", new FakeElement("button")],
        ["focus-current", new FakeElement("button")],
    ]);
    return {
        createElement: (tag) => new FakeElement(tag),
        createElementNS: (_namespace, tag) => new FakeElement(tag),
        querySelector(selector) {
            if (selector.startsWith("#")) return roots.get(selector.slice(1));
            return this.querySelectorAll(selector)[0] || null;
        },
        querySelectorAll(selector) {
            return [...roots.values()].flatMap((root) =>
                root.findAll(selector),
            );
        },
    };
}

class FakeElement {
    constructor(tag) {
        this.tagName = tag;
        this.children = [];
        this.className = "";
        this.dataset = {};
        this.listeners = new Map();
        this.style = new FakeStyle();
        this.hidden = false;
        this.disabled = false;
        this.scrollHeight = 0;
        this.scrollWidth = 800;
        this.scrollLeft = 0;
        this.scrollTop = 0;
        this.scrollIntoViewCount = 0;
        this.clientHeight = 0;
        this.classList = {
            add: (...names) => this.#changeClasses("add", names),
            contains: (name) => this.#classes().has(name),
            remove: (...names) => this.#changeClasses("remove", names),
            toggle: (name) => {
                const classes = this.#classes();
                const adding = !classes.has(name);
                if (adding) classes.add(name);
                else classes.delete(name);
                this.className = [...classes].join(" ");
                return adding;
            },
        };
    }

    get childElementCount() {
        return this.children.length;
    }

    get parentElement() {
        return this.parent || null;
    }

    get clientHeight() {
        if (!this.#classes().has("content")) return this._clientHeight;
        const lineCount = textIn(this).split("\n").length;
        const clamp = Number(this.style.getPropertyValue("--line-clamp"));
        return this.#classes().has("collapsed")
            ? Math.min(lineCount, clamp) * 20
            : lineCount * 20;
    }

    set clientHeight(value) {
        this._clientHeight = value;
    }

    get scrollHeight() {
        if (!this.#classes().has("content")) return this._scrollHeight;
        return textIn(this).split("\n").length * 20;
    }

    set scrollHeight(value) {
        this._scrollHeight = value;
    }

    append(...children) {
        children.forEach((child) => {
            if (child instanceof FakeElement) child.parent = this;
        });
        this.children.push(...children);
        if (this.#classes().has("content")) {
            this.scrollHeight = textIn(this).split("\n").length * 20;
        }
    }

    replaceChildren(...children) {
        children.forEach((child) => {
            if (child instanceof FakeElement) child.parent = this;
        });
        this.children = children;
    }

    addEventListener(type, listener) {
        this.listeners.set(type, listener);
    }

    dispatchEvent(event) {
        this.listeners.get(event.type)?.(event);
        return !event.defaultPrevented;
    }

    closest(selector) {
        const selectors = selector.split(",").map((part) => part.trim());
        let candidate = this;
        while (candidate) {
            if (
                selectors.some((part) =>
                    part.startsWith(".")
                        ? candidate.#classes().has(part.slice(1))
                        : candidate.tagName === part,
                )
            ) {
                return candidate;
            }
            candidate = candidate.parent;
        }
        return null;
    }

    click() {
        const event = {
            propagationStopped: false,
            stopPropagation() {
                this.propagationStopped = true;
            },
        };
        this.#dispatchClick(event);
    }

    setAttribute(name, value) {
        if (name === "class") this.className = value;
        this[name] = value;
    }

    scrollIntoView() {
        this.scrollIntoViewCount += 1;
    }

    querySelector(selector) {
        return this.findAll(selector)[0] || null;
    }

    querySelectorAll(selector) {
        return this.findAll(selector);
    }

    getBoundingClientRect() {
        if (this.#classes().has("family")) {
            return rect(0, 0, 800, 600);
        }
        const lane = this.#closest("lane");
        const family = lane?.parent;
        const lanes =
            family?.children.filter(
                (child) =>
                    child instanceof FakeElement &&
                    child.#classes().has("lane"),
            ) || [];
        const laneIndex = Math.max(0, lanes.indexOf(lane));
        const left = laneIndex * 388;
        const lanePadding = Number.parseFloat(lane?.style.paddingTop || "0");
        if (this.#classes().has("lane")) return rect(left, 0, 340, 600);
        if (this.#classes().has("lane-header")) {
            return rect(left, lanePadding, 340, 82);
        }
        if (this.#classes().has("turn")) {
            const turns = lane.children.filter(
                (child) =>
                    child instanceof FakeElement &&
                    child.#classes().has("turn"),
            );
            return rect(
                left,
                lanePadding + 100 + turns.indexOf(this) * 140,
                340,
                120,
            );
        }
        return rect(left, 0, 0, 0);
    }

    findAll(selector) {
        const matches = this.#matches(selector) ? [this] : [];
        return matches.concat(
            this.children.flatMap((child) =>
                child instanceof FakeElement ? child.findAll(selector) : [],
            ),
        );
    }

    #classes() {
        return new Set(this.className.split(/\s+/).filter(Boolean));
    }

    #dispatchClick(event) {
        this.listeners.get("click")?.(event);
        if (!event.propagationStopped) this.parent?.#dispatchClick(event);
    }

    #changeClasses(operation, names) {
        const classes = this.#classes();
        names.forEach((name) =>
            operation === "remove" ? classes.delete(name) : classes.add(name),
        );
        this.className = [...classes].join(" ");
    }

    #closest(className) {
        let candidate = this;
        while (candidate) {
            if (candidate.#classes().has(className)) return candidate;
            candidate = candidate.parent;
        }
        return null;
    }

    #matches(selector) {
        if (!selector.startsWith(".")) return false;
        const classes = selector.slice(1).split(".");
        const ownClasses = this.#classes();
        return classes.every((name) => ownClasses.has(name));
    }
}

class FakeStyle {
    constructor() {
        return new Proxy(this, {
            set(target, name, value) {
                if (typeof name === "string" && name.startsWith("--")) {
                    return true;
                }
                target[name] = value;
                return true;
            },
        });
    }

    setProperty(name, value) {
        Object.defineProperty(this, name, {
            configurable: true,
            enumerable: true,
            value: String(value),
            writable: true,
        });
    }

    getPropertyValue(name) {
        return this[name] || "";
    }
}

function rect(left, top, width, height) {
    return {
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
    };
}
