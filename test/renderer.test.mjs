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
    assert.match(html, /#notice \{[\s\S]+position: fixed;/);

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
    assert.equal(document.querySelectorAll(".branch-bus").length, 1);
    assert.equal(document.querySelectorAll(".branch-stem").length, 2);
    assert.equal(document.querySelectorAll(".branch-entry.pending").length, 2);
    assert.equal(
        document.querySelectorAll(".branch-stem.pending").length,
        2,
    );
    assert.equal(document.querySelectorAll(".branch-bus.pending").length, 1);
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
    assert.equal(
        document.querySelectorAll(".branch-stem.pending").length,
        1,
    );
    assert.equal(document.querySelectorAll(".branch-bus.pending").length, 0);
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

function fakeDocument() {
    const roots = new Map([
        ["content", new FakeElement("main")],
        ["refresh", new FakeElement("button")],
        ["status", new FakeElement("p")],
        ["notice", new FakeElement("aside")],
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
        this.style = {};
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

    append(...children) {
        children.forEach((child) => {
            if (child instanceof FakeElement) child.parent = this;
        });
        this.children.push(...children);
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

    click() {
        this.listeners.get("click")?.({ stopPropagation() {} });
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

    #changeClasses(operation, names) {
        const classes = this.#classes();
        names.forEach((name) => classes[operation](name));
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
