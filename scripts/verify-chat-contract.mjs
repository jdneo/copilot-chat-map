import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";
import { interceptRpc } from "./fork-contract-transport.mjs";

// An isolated protocol experiment, not a production session manager.
const args = new Map(process.argv.slice(2).map((arg) => {
    const separator = arg.indexOf("=");
    assert.ok(separator > 2, `Expected --name=value: ${arg}`);
    return [arg.slice(2, separator), arg.slice(separator + 1)];
}));
for (const name of ["sdk", "runtime", "version", "output"]) assert.ok(args.get(name), `Missing ${name}`);
const { CopilotClient, CopilotRequestHandler, RuntimeConnection, ToolSet } =
    await import(pathToFileURL(path.resolve(args.get("sdk"))).href);
const home = await mkdtemp(path.join(os.tmpdir(), "chat-contract-"));
const workspace = path.join(home, "workspace");
await mkdir(workspace);
await mkdir(path.join(home, "session-state"));
await writeFile(path.join(workspace, "sentinel.txt"), "PRIVATE SYNTHETIC READ MARKER\n");
const output = path.resolve(args.get("output"));
await mkdir(path.dirname(output), { recursive: true });
const clients = new Set();
const ids = new Set();
const scripts = new Map();
const proxies = new Set();
const report = {
    schemaVersion: 1, startedAt: new Date().toISOString(), platform: process.platform,
    architecture: process.arch, node: process.version, requestedVersion: args.get("version"),
    sdkSha256: createHash("sha256").update(await readFile(args.get("sdk"))).digest("hex"),
    runnerSha256: createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex"),
    transportSha256: createHash("sha256").update(await readFile(new URL("./fork-contract-transport.mjs", import.meta.url))).digest("hex"),
    temporaryHome: home, realModelCalls: 0, syntheticRequests: 0, cases: [], errors: [], cleanup: [],
    fixtureReadAuthorized: args.get("allow-fixture-read") === "true",
};
const save = () => writeFile(output, JSON.stringify(report, null, 2) + "\n");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}
async function bounded(promise, label, ms = 12000) {
    let timer;
    try {
        return await Promise.race([promise, new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error(`TIMEOUT: ${label}`)), ms);
        })]);
    } finally {
        clearTimeout(timer);
    }
}
async function until(check, label) {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
        if (await bounded(Promise.resolve().then(check), label, Math.max(1, deadline - Date.now()))) return;
        await delay(25);
    }
    throw new Error(`TIMEOUT: ${label}`);
}
function plan(mode = "text") {
    return {
        mode, requests: 0, permissions: [], questions: [], toolResults: [],
        entered: deferred(), release: deferred(), permissionSeen: deferred(), questionSeen: deferred(),
    };
}
class SyntheticModel extends CopilotRequestHandler {
    async sendRequest(request, context) {
        const script = scripts.get(context.sessionId);
        assert.ok(script, "Only this run's synthetic sessions may request inference");
        const body = await request.json();
        script.requests++;
        report.syntheticRequests++;
        script.entered.resolve();
        script.toolNames = (body.tools || []).map((tool) => tool.function?.name);
        script.toolResults = (body.messages || []).filter((message) => message.role === "tool");
        if (script.mode === "hold") {
            await Promise.race([
                script.release.promise,
                new Promise((resolve) => {
                    if (context.signal.aborted) resolve();
                    else context.signal.addEventListener("abort", resolve, { once: true });
                }),
            ]);
        }
        let tool;
        if (script.requests === 1 && ["read", "permission", "reject", "ask"].includes(script.mode)) {
            tool = script.mode === "read"
                ? { name: "view", arguments: { path: path.join(workspace, "sentinel.txt") } }
                : script.mode === "ask"
                    ? { name: "ask_user", arguments: { question: "Synthetic unanswered question", choices: ["Yes", "No"] } }
                    : { name: "chat_probe_marker", arguments: {} };
        }
        const message = tool ? {
            role: "assistant", content: null,
            tool_calls: [{ id: `call_${randomUUID()}`, type: "function",
                function: { name: tool.name, arguments: JSON.stringify(tool.arguments) } }],
        } : { role: "assistant", content: `ACK ${context.sessionId}` };
        const finish = tool ? "tool_calls" : "stop";
        if (body.stream) {
            const delta = tool ? { ...message, tool_calls: message.tool_calls.map((call, index) => ({ index, ...call })) } : message;
            const chunk = (value, finish_reason) => ({
                id: "synthetic", object: "chat.completion.chunk", created: 0, model: "gpt-4.1",
                choices: [{ index: 0, delta: value, finish_reason }],
            });
            return new Response(
                `data: ${JSON.stringify(chunk(delta, null))}\n\n` +
                `data: ${JSON.stringify(chunk({}, finish))}\n\ndata: [DONE]\n\n`,
                { headers: { "Content-Type": "text/event-stream" } },
            );
        }
        return new Response(JSON.stringify({
            id: "synthetic", object: "chat.completion", created: 0, model: "gpt-4.1",
            choices: [{ index: 0, message, finish_reason: finish }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }), { headers: { "Content-Type": "application/json" } });
    }
    async openWebSocket() { throw new Error("Synthetic probe forbids upstream WebSockets"); }
}
function config(script) {
    return {
        workingDirectory: workspace, model: "gpt-4.1",
        provider: { type: "openai", baseUrl: "http://127.0.0.1:9/v1" },
        enableConfigDiscovery: false, requestExtensions: false, requestCanvasRenderer: false,
        skipCustomInstructions: true, enableSkills: false, enableSessionStore: false,
        remoteSession: "off", continuePendingWork: false,
        availableTools: ["view", "ask_user", "chat_probe_marker"],
        excludedTools: new ToolSet().addMcp("*"),
        tools: [{
            name: "chat_probe_marker", description: "Synthetic permission probe; never authorized.",
            parameters: { type: "object", properties: {} }, defer: "never",
            handler: () => {
                script.executions = (script.executions || 0) + 1;
                throw new Error("Permission probe must never be authorized");
            },
        }],
        onPermissionRequest: (request) => {
            script.permissions.push({ kind: request.kind, toolCallId: request.toolCallId });
            script.permissionSeen.resolve();
            if (args.get("allow-fixture-read") === "true" && request.kind === "read" &&
                request.path === path.join(workspace, "sentinel.txt")) {
                script.authorizedReads = (script.authorizedReads || 0) + 1;
                return { kind: "approve-once" };
            }
            return script.mode === "reject" ? { kind: "reject" } : new Promise(() => {});
        },
        onUserInputRequest: (request) => {
            script.questions.push(request);
            script.questionSeen.resolve();
            return new Promise(() => {});
        },
    };
}
async function start(connection, external = false) {
    const client = new CopilotClient({
        connection: connection || RuntimeConnection.forStdio({ path: path.resolve(args.get("runtime")) }),
        ...(external ? {} : { baseDirectory: home, useLoggedInUser: false }),
        workingDirectory: workspace, enableRemoteSessions: false,
        ...(external ? {} : { requestHandler: new SyntheticModel() }),
    });
    clients.add(client);
    await bounded(client.start(), "runtime start");
    const status = await client.getStatus();
    assert.equal(status.version, args.get("version"));
    report.runtime = status;
    return client;
}
async function shared() {
    const reservation = createServer();
    await new Promise((resolve, reject) => {
        reservation.once("error", reject);
        reservation.listen(0, "127.0.0.1", resolve);
    });
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const token = randomUUID();
    const owner = await start(RuntimeConnection.forTcp({
        path: path.resolve(args.get("runtime")), port, connectionToken: token,
    }));
    return { owner, port, token };
}
async function attach(runtime, id, script, port = runtime.port) {
    const client = await start(RuntimeConnection.forUri(`127.0.0.1:${port}`, {
        connectionToken: runtime.token,
    }), true);
    const session = watch(await client.resumeSession(id, { ...config(script), tools: [] }));
    return { client, session };
}
async function stop(client, force = false) {
    if (!clients.has(client)) return;
    if (force) await bounded(client.forceStop(), "force stop");
    else assert.deepEqual(await bounded(client.stop(), "stop"), []);
    clients.delete(client);
}
async function create(client, script = plan()) {
    const session = await bounded(client.createSession(config(script)), "create");
    ids.add(session.sessionId);
    scripts.set(session.sessionId, script);
    return watch(session);
}
async function persisted(client, script) {
    const mode = script.mode;
    script.mode = "text";
    const session = await create(client, script);
    await session.send({ prompt: "Completed synthetic setup turn" });
    await idle(session);
    await session.disconnect();
    assert.ok((await disk(session.sessionId)).some((event) => event.type === "assistant.turn_end"));
    const resumed = watch(await client.resumeSession(session.sessionId, config(script)));
    script.mode = mode;
    script.requests = 0;
    script.entered = deferred();
    return resumed;
}
function watch(session) {
    session.observed = [];
    session.on((event) => session.observed.push(event));
    return session;
}
async function idle(session) {
    await until(() => session.observed.some((event) => event.type === "session.idle"), "session idle");
    assert.equal((await session.rpc.metadata.isProcessing()).processing, false);
    assert.equal((await session.rpc.metadata.activity()).hasActiveWork, false);
}
async function disk(id) {
    assert.ok(ids.has(id));
    return (await readFile(path.join(home, "session-state", id, "events.jsonl"), "utf8"))
        .trim().split("\n").filter(Boolean).map(JSON.parse);
}
const compact = (events) => events.filter((event) =>
    /^(user\.message|assistant\.(message|turn_start|turn_end|idle)|session\.(idle|error)|abort|tool\.|permission\.|external_tool\.)/.test(event.type))
    .map(({ id, type, data, ephemeral, agentId }) => ({ id, type, data, ephemeral, agentId }));
async function capture(session, entry) {
    entry.sessionId = session.sessionId;
    entry.live = compact(session.observed);
    entry.history = compact(await session.getEvents());
    entry.processing = await session.rpc.metadata.isProcessing();
    entry.activity = await session.rpc.metadata.activity();
}
async function run(name, action) {
    if (args.get("case") && !name.includes(args.get("case"))) return;
    const entry = { name };
    report.cases.push(entry);
    try {
        await action(entry);
        entry.verdict = "evidence-assertions-passed";
        console.log(`PASS ${name}`);
    } catch (error) {
        entry.error = error.stack;
        report.errors.push({ name, message: error.message });
        console.error(`FAIL ${name}: ${error.message}`);
    } finally {
        for (const script of scripts.values()) script.release.resolve();
        for (const proxy of proxies) await proxy.close();
        proxies.clear();
        for (const client of [...clients]) {
            try { await stop(client); }
            catch (error) {
                report.errors.push({ name, cleanupError: error.message });
                await stop(client, true);
            }
        }
        entry.sensorTotals = {
            modelRequests: report.syntheticRequests,
            unauthorizedMarkerExecutions: [...scripts.values()].reduce((sum, script) => sum + (script.executions || 0), 0),
        };
        assert.equal(entry.sensorTotals.unauthorizedMarkerExecutions, 0);
        await save();
    }
}
async function baseline(entry) {
    const client = await start();
    const session = await create(client);
    entry.messageId = await session.send({ prompt: "Synthetic correlation baseline" });
    await idle(session);
    await capture(session, entry);
    const user = entry.history.find((event) => event.type === "user.message");
    const answer = entry.history.find((event) => event.type === "assistant.message");
    assert.equal(user.data.messageId, entry.messageId);
    assert.equal(answer.data.originatingMessageId, entry.messageId);
    assert.equal(answer.data.content, `ACK ${session.sessionId}`);
    assert.ok(entry.history.some((event) => event.type === "assistant.turn_end"));
    await session.disconnect();
    entry.diskAfterRelease = compact(await disk(session.sessionId));
    assert.ok(entry.diskAfterRelease.some((event) => event.type === "user.message" &&
        event.data.messageId === entry.messageId));
    assert.ok(!entry.diskAfterRelease.some((event) => event.type === "session.idle"));
    await stop(client);
    const recoveredClient = await start();
    const before = scripts.get(session.sessionId).requests;
    const recovered = await recoveredClient.resumeSession(session.sessionId, config(scripts.get(session.sessionId)));
    assert.ok((await recovered.getEvents()).some((event) => event.id === answer.id));
    assert.equal(scripts.get(session.sessionId).requests, before);
    entry.coldRecoveredAnswerId = answer.id;
}
async function toolCase(entry, mode) {
    if (mode === "read") {
        assert.equal(args.get("allow-fixture-read"), "true", "The fixture read requires explicit human authorization");
    }
    const client = await start();
    const script = plan(mode);
    const session = await create(client, script);
    entry.messageId = await session.send({ prompt: `Synthetic ${mode} scenario` });
    if (mode === "read" || mode === "reject") {
        try { await idle(session); }
        finally {
            await capture(session, entry);
            entry.permissions = script.permissions;
            entry.offeredTools = script.toolNames;
            entry.modelRequests = script.requests;
        }
        entry.toolResults = script.toolResults;
        if (mode === "read") {
            assert.ok(script.requests >= 2, "Tool result must return through the model loop");
            assert.ok(JSON.stringify(script.toolResults).includes("PRIVATE SYNTHETIC READ MARKER"));
            assert.equal(script.authorizedReads, 1, "Only the human-authorized fixture read may execute");
        } else {
            assert.equal(script.permissions.length, 1);
            assert.equal(script.executions || 0, 0);
        }
    } else {
        await bounded(mode === "ask" ? script.questionSeen.promise : script.permissionSeen.promise, "interaction observed");
        await delay(200);
        assert.equal(script.requests, 1, "Waiting must not trigger a follow-up model request");
        assert.equal(script.executions || 0, 0);
        assert.equal((await session.rpc.metadata.isProcessing()).processing, true);
        assert.ok(!session.observed.some((event) => event.type === "session.idle"));
        entry.pendingBeforeStop = await session.rpc.permissions.pendingRequests();
        entry.stopResult = await bounded(session.rpc.abort({}), "stop waiting interaction");
        assert.equal(entry.stopResult.success, true);
        await idle(session);
    }
    await capture(session, entry);
    entry.permissions = script.permissions;
    entry.questions = script.questions;
    entry.executions = script.executions || 0;
    entry.authorizedFixtureReads = script.authorizedReads || 0;
    await session.disconnect();
    await stop(client);
    const receiver = await start();
    const before = script.requests;
    const resumed = watch(await receiver.resumeSession(session.sessionId, config(script)));
    await delay(100);
    assert.equal(script.requests, before, "Cold resume must not continue waiting work");
    script.mode = "text";
    resumed.observed.length = 0;
    entry.nextMessageId = await resumed.send({ prompt: "Explicit new turn after release" });
    await idle(resumed);
    assert.ok((await resumed.getEvents()).some((event) =>
        event.type === "assistant.message" && event.data.originatingMessageId === entry.nextMessageId));
    entry.independentOwnerNewTurn = true;
}
async function stoppedText(entry, race = false) {
    const client = await start();
    const script = plan("hold");
    const session = await create(client, script);
    entry.messageId = await session.send({ prompt: "Synthetic gated response" });
    await bounded(script.entered.promise, "model gate");
    assert.equal((await session.rpc.metadata.isProcessing()).processing, true);
    if (race) script.release.resolve();
    entry.stopResult = await bounded(session.rpc.abort({}), "abort text");
    await idle(session);
    await capture(session, entry);
    assert.equal(entry.stopResult.success, true);
    assert.ok(session.observed.some((event) => event.type === "abort" || event.type === "assistant.turn_end"));
    entry.finalObserved = entry.history.filter((event) => event.type === "assistant.message");
}
async function duplicate(entry, competing = false) {
    const runtime = await shared();
    const script = plan("hold");
    const first = await create(runtime.owner, script);
    const second = competing ? (await attach(runtime, first.sessionId, script)).session : first;
    const prompt = "Identical synthetic delivery";
    entry.messageIds = await Promise.all([first.send({ prompt }), second.send({ prompt })]);
    assert.notEqual(...entry.messageIds, "Negative control: native sends are not idempotent");
    entry.pending = await first.rpc.queue.pendingItems();
    script.mode = "text";
    script.release.resolve();
    await until(async () => {
        const events = await first.getEvents();
        return events.filter((event) => event.type === "user.message").length === 2 &&
            !(await first.rpc.metadata.activity()).hasActiveWork;
    }, "duplicate deliveries consumed");
    await capture(first, entry);
    assert.equal(entry.history.filter((event) => event.type === "user.message").length, 2);
    entry.nativeDeduplication = false;
}
async function lifecycle(entry, mode) {
    const runtime = await shared();
    const script = plan("hold");
    const session = await persisted(runtime.owner, script);
    entry.messageId = await session.send({ prompt: `Synthetic lifecycle ${mode}` });
    await bounded(script.entered.promise, "model gate");
    const before = script.requests;
    if (mode === "panel-close") {
        const unsubscribe = session.on(() => {});
        unsubscribe();
        const reader = await attach(runtime, session.sessionId, script);
        entry.processingOnReattach = await reader.session.rpc.metadata.isProcessing();
        assert.equal(entry.processingOnReattach.processing, true);
        assert.equal(script.requests, before);
        script.release.resolve();
        await idle(session);
        await capture(reader.session, entry);
    } else if (mode === "normal-unload") {
        entry.stopResult = await session.rpc.abort({});
        await idle(session);
        await session.disconnect();
        await stop(runtime.owner);
    } else {
        entry.liveBeforeCrash = compact(await session.getEvents());
        assert.ok(entry.liveBeforeCrash.some((event) => event.type === "user.message" &&
            event.data.messageId === entry.messageId));
        if (mode === "runtime-crash-save") {
            await runtime.owner.rpc.sessions.save({ sessionId: session.sessionId });
            entry.diskBeforeCrash = compact(await disk(session.sessionId));
            assert.ok(entry.diskBeforeCrash.some((event) => event.type === "user.message" &&
                event.data.messageId === entry.messageId));
        }
        // Only the runtime created by this scenario is terminated.
        await stop(runtime.owner, true);
    }
    if (mode !== "panel-close") {
        const cold = await start();
        const recovered = watch(await cold.resumeSession(session.sessionId, config(script)));
        await delay(200);
        assert.equal(script.requests, before, "Recovery must not request another inference");
        assert.equal((await recovered.rpc.metadata.activity()).hasActiveWork, false);
        await capture(recovered, entry);
        entry.userMessagePreserved = entry.history.some((event) =>
            event.type === "user.message" && event.data.messageId === entry.messageId);
        if (mode === "runtime-crash-save") assert.equal(entry.userMessagePreserved, true);
        entry.answerCount = entry.history.filter((event) => event.type === "assistant.message" &&
            event.data.originatingMessageId === entry.messageId).length;
        assert.equal(entry.answerCount, 0);
        // A hard crash may precede journal flushing; missing history is not a resend receipt.
        entry.recoverySendCalls = 0;
    }
}
async function forkBranches(entry) {
    const owner = await start();
    const source = await persisted(owner, plan());
    const original = await source.getEvents();
    const children = [];
    for (let index = 0; index < 2; index++) {
        const { sessionId } = await owner.rpc.sessions.fork({
            sessionId: source.sessionId, name: `Synthetic chat branch ${index}`,
        });
        ids.add(sessionId);
        const script = plan();
        scripts.set(sessionId, script);
        children.push(watch(await owner.resumeSession(sessionId, config(script))));
    }
    assert.deepEqual((await source.getEvents()).slice(0, original.length), original);
    entry.children = [];
    for (const child of children) {
        const firstId = await child.send({ prompt: "First branch turn" });
        await idle(child);
        await child.disconnect();
        const cold = watch(await owner.resumeSession(child.sessionId, config(scripts.get(child.sessionId))));
        const secondId = await cold.send({ prompt: "Next turn after branch release" });
        await idle(cold);
        const events = await cold.getEvents();
        const answers = events.filter((event) => event.type === "assistant.message" &&
            [firstId, secondId].includes(event.data.originatingMessageId));
        assert.equal(answers.length, 2);
        assert.ok(answers.every((event) => event.data.content === `ACK ${child.sessionId}`));
        entry.children.push({ sessionId: child.sessionId, firstId, secondId, answers: compact(answers) });
        await cold.disconnect();
    }
    const originalUserIds = original.filter((event) => event.type === "user.message").map((event) => event.id);
    assert.deepEqual((await source.getEvents()).filter((event) => event.type === "user.message")
        .map((event) => event.id), originalUserIds);
}
async function occupancy(entry, tcp) {
    const runtime = tcp ? await shared() : { owner: await start() };
    const script = plan();
    let source = await create(runtime.owner, script);
    await source.send({ prompt: "Occupancy setup turn" });
    await idle(source);
    const observer = await start();
    const inUse = async () => (await observer.rpc.sessions.checkInUse({
        sessionIds: [source.sessionId],
    })).inUse.includes(source.sessionId);
    entry.occupiedAfterCreate = await inUse();
    await source.disconnect();
    entry.occupiedAfterDisconnect = await inUse();
    source = watch(await runtime.owner.resumeSession(source.sessionId, config(script)));
    entry.occupiedAfterWarmResume = await inUse();
    entry.ownerRespondsAfterWarmResume = (await source.getEvents()).some((event) => event.type === "user.message");
    assert.equal(entry.ownerRespondsAfterWarmResume, true);
    await delay(1000);
    entry.occupiedAfterDelay = await inUse();
    const competing = await observer.resumeSession(source.sessionId, config(script));
    entry.competingResumeWarning = (await competing.rpc.metadata.snapshot()).alreadyInUse;
    entry.ownerSeesCompetitor = (await runtime.owner.rpc.sessions.checkInUse({
        sessionIds: [source.sessionId],
    })).inUse.includes(source.sessionId);
    await competing.disconnect();
    entry.occupiedAfterCompetitorRelease = await inUse();
    if (tcp) {
        const peer = await attach(runtime, source.sessionId, script);
        entry.sameRuntimeOtherOwner = (await peer.client.rpc.sessions.checkInUse({
            sessionIds: [source.sessionId],
        })).inUse.includes(source.sessionId);
        await peer.session.disconnect();
        assert.equal((await source.rpc.metadata.activity()).hasActiveWork, false);
    }
    entry.concurrentSendCalls = 0;
    await source.disconnect();
    assert.equal(await inUse(), false);
    await stop(runtime.owner);
    const freshOwner = await start();
    const coldOwned = await freshOwner.resumeSession(source.sessionId, config(script));
    entry.occupiedAfterFreshRuntimeResume = await inUse();
    assert.equal((await coldOwned.rpc.metadata.activity()).hasActiveWork, false);
    await coldOwned.disconnect();
    await stop(freshOwner);
    const acquired = watch(await observer.resumeSession(source.sessionId, config(script)));
    const receipt = await acquired.send({ prompt: "Explicit new independent owner" });
    await idle(acquired);
    assert.ok((await acquired.getEvents()).some((event) => event.type === "assistant.message" &&
        event.data.originatingMessageId === receipt));
    entry.releasedAndAcquired = true;
    // Pin the observed counterexample rather than falsely certifying exclusion.
    assert.equal(entry.occupiedAfterCreate, true);
    assert.equal(entry.occupiedAfterDisconnect, false);
    assert.equal(entry.occupiedAfterWarmResume, false);
    assert.equal(entry.occupiedAfterDelay, false);
    assert.equal(entry.competingResumeWarning, false);
    assert.equal(entry.ownerSeesCompetitor, false);
    assert.equal(entry.occupiedAfterFreshRuntimeResume, false);
    entry.ownershipDetectionCounterexample = true;
}
async function rejectedSend(entry) {
    const owner = await start();
    const session = await persisted(owner, plan());
    const before = await session.getEvents();
    await session.disconnect();
    await assert.rejects(session.send({
        prompt: "Synthetic send on disconnected handle",
    }), (error) => {
        entry.rejection = error.message;
        return true;
    });
    entry.addedEvents = compact((await disk(session.sessionId)).slice(before.length));
    assert.ok(!entry.addedEvents.some((event) => event.type === "user.message"));
}
async function completedThenStopped(entry) {
    const owner = await start();
    const session = await create(owner);
    const receipt = await session.send({ prompt: "Finish before stop" });
    await idle(session);
    const answer = (await session.getEvents()).find((event) => event.type === "assistant.message");
    entry.stopResult = await session.rpc.abort({});
    assert.ok((await session.getEvents()).some((event) => event.id === answer.id &&
        event.data.originatingMessageId === receipt));
    await capture(session, entry);
    entry.completedAnswerPreserved = true;
}
async function droppedLastConnection(entry) {
    const runtime = await shared();
    const script = plan("hold");
    const stored = await persisted(runtime.owner, script);
    await stored.disconnect();
    const proxy = await interceptRpc({ upstreamPort: runtime.port, method: "unused.probe" });
    proxies.add(proxy);
    const caller = await attach(runtime, stored.sessionId, script, proxy.port);
    entry.messageId = await caller.session.send({ prompt: "Lose the only session attachment" });
    await bounded(script.entered.promise, "model gate");
    await runtime.owner.rpc.sessions.save({ sessionId: stored.sessionId });
    const before = script.requests;
    await proxy.close();
    proxies.delete(proxy);
    await stop(caller.client, true);
    const resumed = watch(await runtime.owner.resumeSession(stored.sessionId, config(script)));
    entry.activityOnReconnect = await resumed.rpc.metadata.activity();
    assert.equal(script.requests, before);
    if (entry.activityOnReconnect.hasActiveWork) {
        script.release.resolve();
        await idle(resumed);
    }
    await capture(resumed, entry);
    assert.equal(script.requests, before);
    entry.reconnectSendCalls = 0;
}
async function sendFault(entry, cutAt, kill = false) {
    const runtime = await shared();
    const script = plan("hold");
    const retained = await persisted(runtime.owner, script);
    const cutSeen = deferred();
    const proxy = await interceptRpc({
        upstreamPort: runtime.port, method: "session.send",
        ...(cutAt === "before" ? {
            onRequest: async ({ cut }) => {
                cut();
                if (kill) await stop(runtime.owner, true);
                cutSeen.resolve();
            },
        } : {
            onResponse: async ({ cut }) => {
                cut();
                if (kill) await stop(runtime.owner, true);
                cutSeen.resolve();
            },
        }),
    });
    proxies.add(proxy);
    const caller = await attach(runtime, retained.sessionId, script, proxy.port);
    entry.sendCalls = 1;
    try {
        entry.callerReceipt = await bounded(caller.session.send({ prompt: "Synthetic lost acknowledgement" }), "lost receipt", 1500);
    } catch (error) { entry.callerError = error.message; }
    await bounded(cutSeen.promise, "fault injected");
    await stop(caller.client, true);
    entry.oracle = proxy.observed;
    await proxy.close();
    proxies.delete(proxy);
    const recoveryClient = kill ? await start() : runtime.owner;
    const before = script.requests;
    const recovered = kill
        ? watch(await recoveryClient.resumeSession(retained.sessionId, config(script))) : retained;
    await capture(recovered, entry);
    assert.equal(entry.callerReceipt, undefined);
    const users = entry.history.filter((event) => event.type === "user.message" &&
        event.data.content === "Synthetic lost acknowledgement");
    if (cutAt === "before") assert.equal(users.length, 0);
    else if (!kill) {
        assert.equal(users.length, 1);
        assert.equal(users[0].data.messageId, entry.oracle.runtimeResult.messageId);
        assert.equal(entry.activity.hasActiveWork, true);
        script.release.resolve();
        await idle(recovered);
        entry.completedHistory = compact(await recovered.getEvents());
    }
    assert.equal(script.requests, before, "Read/reconnect must not resubmit");
    entry.recoverySendCalls = 0;
}
async function releaseFailure(entry) {
    const runtime = await shared();
    const script = plan();
    const retained = await create(runtime.owner, script);
    const proxy = await interceptRpc({
        upstreamPort: runtime.port, method: "session.detach",
        onRequest: ({ respond }) => respond({ success: false, error: "Synthetic detach failure" }),
    });
    proxies.add(proxy);
    const caller = await attach(runtime, retained.sessionId, script, proxy.port);
    await assert.rejects(caller.session.disconnect(), (error) => {
        entry.errorObserved = error.message;
        return error.message.includes("Synthetic detach failure");
    });
    entry.nativeDetachAttempts = proxy.observed.forkRequests;
    assert.equal(entry.nativeDetachAttempts, 2, "SDK retries a negative detach response");
    assert.equal((await caller.session.rpc.metadata.activity()).hasActiveWork, false);
    await proxy.close();
    proxies.delete(proxy);
    await stop(caller.client, true);
    entry.ownerStillReadable = (await retained.getEvents()).length > 0;
    assert.equal(entry.ownerStillReadable, true);
}
try {
    await save();
    await run("text-correlation-persistence-cold-resume", baseline);
    if (args.get("mode") !== "baseline") {
        await run("native-duplicate-delivery-negative-control", (entry) => duplicate(entry));
        await run("same-runtime-two-panel-negative-control", (entry) => duplicate(entry, true));
        for (const mode of ["read", "permission", "ask", "reject"]) {
            await run(`tool-${mode}`, (entry) => toolCase(entry, mode));
        }
        await run("stop-in-flight-text", (entry) => stoppedText(entry));
        await run("stop-completion-race", (entry) => stoppedText(entry, true));
        await run("completed-before-stop", completedThenStopped);
        for (const mode of ["panel-close", "normal-unload", "runtime-crash", "runtime-crash-save"]) {
            await run(`lifecycle-${mode}`, (entry) => lifecycle(entry, mode));
        }
        for (const cutAt of ["before", "after"]) {
            for (const kill of [false, true]) {
                await run(`send-cut-${cutAt}-${kill ? "exit" : "disconnect"}`,
                    (entry) => sendFault(entry, cutAt, kill));
            }
        }
        await run("detach-negative-response-observable", releaseFailure);
        await run("new-fork-and-cold-branch-multiturn", forkBranches);
        await run("external-occupancy-tcp", (entry) => occupancy(entry, true));
        await run("external-occupancy-stdio", (entry) => occupancy(entry, false));
        await run("definite-send-rejection", rejectedSend);
        await run("drop-last-session-connection", droppedLastConnection);
    }
    assert.ok(report.cases.length > 0, "No scenarios matched");
} finally {
    for (const client of [...clients]) await stop(client, true);
    const cleaner = await start();
    for (const id of ids) {
        await bounded(cleaner.deleteSession(id), "delete synthetic session");
        await assert.rejects(disk(id), { code: "ENOENT" });
        report.cleanup.push({ sessionId: id, deleted: true });
    }
    await stop(cleaner);
    assert.ok(path.basename(home).startsWith("chat-contract-") && path.dirname(home) === os.tmpdir());
    await rm(home, { recursive: true, force: true });
    report.temporaryHomeRemoved = true;
    report.finishedAt = new Date().toISOString();
    report.remainingHarnessResources = process.getActiveResourcesInfo();
    await save();
}
// Lost RPCs can leave SDK timers alive. All owned runtimes/storage are cleaned above.
process.exit(report.errors.length ? 1 : 0);
