import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import { renderHtml } from "../extension/renderer.mjs";

test("renders selectable checkpoint controls and the fork API workflow", () => {
    const html = renderHtml();

    assert.match(html, /"\+ Fork"/);
    assert.match(html, /\/api\/fork/);
    assert.match(html, /crypto\.randomUUID\(\)/);
    assert.match(html, /state\.canFork/);
    assert.match(html, /Open it manually from the session list/);
    assert.doesNotMatch(html, /<header>/);
    assert.doesNotMatch(html, /<h1>Conversation Fork Map<\/h1>/);
    assert.match(
        html,
        /<button id="refresh"[^>]+aria-label="Refresh"[^>]+title="Refresh"/,
    );
    assert.match(html, /<svg[^>]+aria-hidden="true"/);
    assert.match(html, /#refresh \{[\s\S]+background: #1f6feb;/);
    assert.match(html, /#refresh svg \{[\s\S]+stroke: #fff;/);
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
