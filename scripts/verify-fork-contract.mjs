import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createLineageStore } from "../com.github.copilot/extensions/chat-fork-map/lineage-store.mjs";
import { interceptFork } from "./fork-contract-transport.mjs";

const args = new Map(process.argv.slice(2).map((arg) => {
    const separator = arg.indexOf("=");
    assert.ok(separator > 2, `Expected --name=value, received ${arg}`);
    return [arg.slice(2, separator), arg.slice(separator + 1)];
}));
for (const name of ["sdk", "runtime", "version", "output"]) {
    assert.ok(args.get(name), `Missing --${name}=value`);
}
const { CopilotClient, CopilotRequestHandler, RuntimeConnection, ToolSet } =
    await import(pathToFileURL(path.resolve(args.get("sdk"))).href);
const runtimePath = path.resolve(args.get("runtime"));
const output = path.resolve(args.get("output"));
const mode = args.get("mode") || "baseline";
assert.ok(["baseline", "boundaries", "faults", "all", "ownership-recheck", "guarded-race", "pending-work"].includes(mode), "Unknown mode");
const repeats = Number(args.get("repeats") || "1");
assert.ok(Number.isInteger(repeats) && repeats > 0 && repeats <= 20);
const home = await mkdtemp(path.join(os.tmpdir(), "fork-contract-"));
const workspace = path.join(home, "workspace");
await mkdir(workspace);
await mkdir(path.join(home, "session-state"));
const clients = new Set();
const ownedIds = new Set();
const report = {
    schemaVersion: 1,
    runId: randomUUID(),
    startedAt: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    requestedVersion: args.get("version"),
    mode,
    repeats,
    modelCalls: 0,
    cases: [],
    errors: [],
    cleanup: [],
    temporaryHome: home,
};
await mkdir(path.dirname(output), { recursive: true });
const save = () => writeFile(output, JSON.stringify(report, null, 2) + "\n");
await save();
const config = {
    workingDirectory: workspace,
    availableTools: [],
    excludedTools: new ToolSet().addBuiltIn("*").addMcp("*").addCustom("*"),
    enableConfigDiscovery: false,
    requestExtensions: false,
    requestCanvasRenderer: false,
    skipCustomInstructions: true,
    enableSkills: false,
    enableSessionStore: false,
    remoteSession: "off",
    onPermissionRequest: () => ({ kind: "reject" }),
};
const modelAttempts = [];
class BlockModelTransport extends CopilotRequestHandler {
    async sendRequest(request, context) {
        modelAttempts.push({ sessionId: context.sessionId, transport: context.transport });
        return new Response(JSON.stringify({
            error: { message: "Synthetic probe blocks all model requests", type: "invalid_request_error" },
        }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    async openWebSocket(context) {
        modelAttempts.push({ sessionId: context.sessionId, transport: context.transport });
        throw new Error("Synthetic probe blocks model WebSockets");
    }
}
const blockedModelTransport = new BlockModelTransport();
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const journalPath = (id) => {
    assert.ok(ownedIds.has(id), "Cannot access a session not owned by this run");
    return path.join(home, "session-state", id, "events.jsonl");
};
const readEvents = async (id) => (await readFile(journalPath(id), "utf8"))
    .trim().split("\n").filter(Boolean).map(JSON.parse);
const summary = (events) => events.map((event) => ({
    id: event.id, type: event.type, hash: digest(event),
}));
const preserved = (before, after) => before.every((event, index) =>
    after[index] && digest(event) === digest(after[index]));
const conversation = (events) => events
    .filter((event) => ["user.message", "assistant.message", "assistant.turn_end"].includes(event.type));

async function assertChild(source, childId, boundary) {
    const expected = boundary === "earlier" ? source.events.slice(0, 4) : source.events;
    const actual = await readEvents(childId);
    assert.deepEqual(actual.slice(1, expected.length), expected.slice(1),
        "Every inherited non-start event must retain its content, ID and order");
    assert.deepEqual(conversation(actual), conversation(expected));
    // Native fork renews the start envelope for the child, but keeps its event ID.
    assert.equal(actual[0].id, expected[0].id);
    assert.equal(actual[0].type, "session.start");
    assert.equal(actual[0].parentId, null);
    assert.equal(actual[0].data.sessionId, childId);
    assert.equal(actual[0].data.producer, expected[0].data.producer);
    assert.equal(actual[0].data.version, expected[0].data.version);
    assert.deepEqual(actual[0].data.context, expected[0].data.context);
    assert.ok(Number.isFinite(Date.parse(actual[0].timestamp)));
    assert.ok(Number.isFinite(Date.parse(actual[0].data.startTime)));
    assert.ok(actual.some((event) => event.type === "session.info" &&
        event.data.infoType === "fork" && event.data.message.includes(source.id) &&
        event.data.message.includes(childId)));
    return expected;
}

async function bounded(promise, label, milliseconds = 15000) {
    let timer;
    try {
        return await Promise.race([promise, new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error(`PROBE_TIMEOUT: ${label}`)), milliseconds);
        })]);
    } finally {
        clearTimeout(timer);
    }
}

async function start(connection, external = false) {
    const client = new CopilotClient({
        connection: connection || RuntimeConnection.forStdio({ path: runtimePath }),
        ...(external ? {} : { baseDirectory: home, useLoggedInUser: false }),
        workingDirectory: workspace,
        enableRemoteSessions: false,
        ...(mode === "pending-work" ? { requestHandler: blockedModelTransport } : {}),
    });
    clients.add(client);
    await bounded(client.start(), "runtime start");
    const status = await client.getStatus();
    assert.equal(status.version, report.requestedVersion, "Actual runtime version mismatch");
    report.runtime = status;
    report.capabilities = Object.fromEntries(["fork", "checkInUse", "list", "close"]
        .map((name) => [name, typeof client.rpc.sessions[name] === "function"]));
    report.capabilities.deleteSession = typeof client.deleteSession === "function";
    assert.ok(Object.values(report.capabilities).every(Boolean));
    return client;
}

async function sharedRuntime(withPeer = true) {
    const reservation = createServer();
    await new Promise((resolve, reject) => {
        reservation.once("error", reject);
        reservation.listen(0, "127.0.0.1", resolve);
    });
    const port = reservation.address().port;
    await new Promise((resolve, reject) =>
        reservation.close((error) => error ? reject(error) : resolve()));
    const connectionToken = randomUUID();
    const owner = await start(RuntimeConnection.forTcp({ path: runtimePath, port, connectionToken }));
    const peer = withPeer
        ? await start(RuntimeConnection.forUri(`127.0.0.1:${port}`, { connectionToken }), true)
        : undefined;
    return { owner, peer, port, connectionToken };
}

async function stop(client) {
    if (!clients.has(client)) return;
    const errors = await bounded(client.stop(), "runtime stop");
    assert.deepEqual(errors, [], "Runtime cleanup failed");
    clients.delete(client);
}

async function fixture() {
    const id = randomUUID();
    ownedIds.add(id);
    const timestamp = new Date().toISOString();
    const events = [
        {
            type: "session.start",
            data: {
                sessionId: id, version: 1, producer: "copilot-agent",
                copilotVersion: report.requestedVersion, startTime: timestamp,
                context: { cwd: workspace },
            },
        },
        { type: "user.message", data: { content: "Synthetic first turn", messageId: randomUUID() } },
        { type: "assistant.message", data: { content: "ACK one", messageId: randomUUID() } },
        { type: "assistant.turn_end", data: { turnId: "0" } },
        { type: "user.message", data: { content: "Synthetic second turn", messageId: randomUUID() } },
        { type: "assistant.message", data: { content: "ACK two", messageId: randomUUID() } },
        { type: "assistant.turn_end", data: { turnId: "1" } },
    ];
    for (let index = 0; index < events.length; index++) {
        Object.assign(events[index], {
            id: randomUUID(), timestamp, parentId: events[index - 1]?.id ?? null,
        });
    }
    await mkdir(path.dirname(journalPath(id)));
    await writeFile(journalPath(id), events.map(JSON.stringify).join("\n") + "\n", { flag: "wx" });
    return { id, events, boundary: events[4].id };
}

function pendingConfig(audit, policy) {
    return {
        ...config,
        model: "gpt-4.1",
        provider: { type: "openai", baseUrl: "http://127.0.0.1:9/v1" },
        availableTools: ["fork_probe_marker"],
        excludedTools: new ToolSet().addBuiltIn("*").addMcp("*"),
        tools: [{
            name: "fork_probe_marker",
            description: "A synthetic no-side-effect probe that only increments a counter.",
            parameters: { type: "object", properties: {} },
            defer: "never",
            handler: () => {
                audit.toolInvocations++;
                return "Synthetic marker; no side effects";
            },
        }],
        onPermissionRequest: () => {
            audit.permissionCallbacks++;
            return { kind: "reject" };
        },
        ...(policy === "omitted" ? {} : { continuePendingWork: policy === "true" }),
    };
}

async function unfinishedFixture(kind) {
    const source = await fixture();
    const toolCallId = randomUUID();
    const pending = [
        { type: "user.message", data: { content: "Synthetic unfinished third turn", messageId: randomUUID() } },
    ];
    if (kind !== "awaiting-assistant") {
        pending.push({ type: "assistant.turn_start", data: { turnId: "2" } });
    }
    if (["tool-requested", "tool-started", "external-tool-pending", "permission-pending"].includes(kind)) {
        pending.push({
            type: "assistant.message",
            data: {
                content: "", messageId: randomUUID(), turnId: "2",
                toolRequests: [{ toolCallId, name: "fork_probe_marker", arguments: {} }],
            },
        });
    }
    if (["tool-started", "external-tool-pending", "permission-pending"].includes(kind)) {
        pending.push({
            type: "tool.execution_start",
            data: { toolCallId, toolName: "fork_probe_marker", arguments: {}, turnId: "2" },
        });
    }
    if (kind === "external-tool-pending") {
        pending.push({
            type: "external_tool.requested",
            data: {
                requestId: randomUUID(), sessionId: source.id, toolCallId,
                toolName: "fork_probe_marker", arguments: {}, workingDirectory: workspace,
            },
        });
    }
    if (kind === "permission-pending") {
        pending.push({
            type: "permission.requested",
            data: {
                requestId: randomUUID(),
                permissionRequest: {
                    kind: "custom-tool", toolCallId, toolName: "fork_probe_marker",
                    toolDescription: "Synthetic no-side-effect marker", args: {},
                },
            },
        });
    }
    for (const event of pending) {
        Object.assign(event, {
            id: randomUUID(), timestamp: new Date().toISOString(),
            parentId: source.events.at(-1).id,
        });
        source.events.push(event);
    }
    // The only rewrite is construction of this run's synthetic fixture, before any runtime loads it.
    await writeFile(journalPath(source.id), source.events.map(JSON.stringify).join("\n") + "\n");
    return source;
}

async function calibrateModelSensor() {
    const caller = await start();
    const source = await fixture();
    const audit = { toolInvocations: 0, permissionCallbacks: 0 };
    const loaded = await caller.resumeSession(source.id, pendingConfig(audit, "false"));
    const before = modelAttempts.length;
    let errorMessage;
    try {
        await bounded(loaded.sendAndWait({
            prompt: "Synthetic calibration only. No real model or tool execution is permitted.",
        }, 10000), "model sensor calibration", 12000);
    } catch (error) {
        errorMessage = error.message;
    }
    assert.ok(modelAttempts.length > before, "An explicit send must reach the blocking sensor");
    report.modelSensorCalibration = {
        explicitControlSend: true,
        interceptedRequests: modelAttempts.length - before,
        realModelCalls: 0,
        error: errorMessage,
    };
    await bounded(loaded.rpc.tools.execute({
        name: "fork_probe_marker", arguments: {},
    }), "permission sensor calibration");
    assert.ok(audit.permissionCallbacks > 0, "Native tool execution must reach the permission sensor");
    assert.equal(audit.toolInvocations, 0, "Rejected permission must not execute the marker");
    report.modelSensorCalibration.permissionCallbacks = audit.permissionCallbacks;
    await stop(caller);
    const toolCaller = await start();
    const toolSource = await fixture();
    const toolAudit = { toolInvocations: 0, permissionCallbacks: 0 };
    const toolConfig = pendingConfig(toolAudit, "false");
    // Only this no-side-effect calibration marker may bypass its prompt; never any real tool.
    toolConfig.tools[0].skipPermission = true;
    const toolSession = await toolCaller.resumeSession(toolSource.id, toolConfig);
    await bounded(toolSession.rpc.tools.execute({
        name: "fork_probe_marker", arguments: {},
    }), "tool sensor calibration");
    assert.equal(toolAudit.toolInvocations, 1);
    report.modelSensorCalibration.harmlessToolInvocations = toolAudit.toolInvocations;
    await stop(toolCaller);
    await save();
}

async function pendingResume(kind, policy) {
    await observeCase(`pending-resume-${kind}`, policy, async (entry) => {
        const source = await unfinishedFixture(kind);
        const caller = await start();
        const audit = { toolInvocations: 0, permissionCallbacks: 0 };
        const requestOffset = modelAttempts.length;
        const before = await readEvents(source.id);
        const resumed = await caller.resumeSession(source.id, pendingConfig(audit, policy));
        entry.sourceId = source.id;
        entry.continuePendingWork = policy;
        entry.before = summary(before);
        await new Promise((resolve) => setTimeout(resolve, 500));
        entry.processingAfterResume = (await resumed.rpc.metadata.isProcessing()).processing;
        entry.pendingPermissionsAfterResume = await resumed.rpc.permissions.pendingRequests();
        entry.queueAfterResume = await resumed.rpc.queue.pendingItems();
        const liveEvents = await resumed.getEvents();
        entry.appendedInMemoryOnResume = liveEvents.slice(before.length).map((event) => ({
            type: event.type, data: event.data,
        }));
        const afterResume = await readEvents(source.id);
        entry.originalPrefixPreserved = preserved(before, afterResume);
        assert.equal(entry.originalPrefixPreserved, true);
        entry.appendedOnResume = afterResume.slice(before.length).map((event) => ({
            type: event.type, data: event.data,
        }));
        if (policy !== "true") {
            assert.equal(modelAttempts.length - requestOffset, 0, "Resume unexpectedly requested model inference");
            assert.equal(audit.toolInvocations, 0, "Resume unexpectedly executed a tool");
            assert.equal(audit.permissionCallbacks, 0, "Resume unexpectedly re-prompted for permission");
            assert.equal(entry.processingAfterResume, false);
            const childId = await fork(caller, source, "earlier");
            entry.childId = childId;
            await assertChild(source, childId, "earlier");
            await stop(caller);
            assert.ok(preserved(before, await readEvents(source.id)));
            entry.appendedAfterOwnerRelease = (await readEvents(source.id))
                .slice(before.length).map((event) => ({ type: event.type, data: event.data }));
            const verifier = await start();
            await coldVerify(verifier, childId, source.events.slice(0, 4));
            entry.childCheckpointAndColdResume = true;
            const recovered = await verifier.resumeSession(source.id, pendingConfig(audit, "false"));
            assert.deepEqual(conversation(await recovered.getEvents()), conversation(source.events));
            assert.equal((await recovered.rpc.metadata.isProcessing()).processing, false);
            await stop(verifier);
            entry.parentColdResume = true;
        } else {
            // Opt-in continuation is a contrast, never part of the proposed fork-loading protocol.
            await stop(caller);
            entry.appendedAfterOwnerRelease = (await readEvents(source.id))
                .slice(before.length).map((event) => ({ type: event.type, data: event.data }));
        }
        entry.modelRequestAttempts = modelAttempts.length - requestOffset;
        entry.toolInvocations = audit.toolInvocations;
        entry.permissionCallbacks = audit.permissionCallbacks;
        if (policy !== "true") {
            assert.equal(entry.modelRequestAttempts, 0);
            assert.equal(entry.toolInvocations, 0);
            assert.equal(entry.permissionCallbacks, 0);
        }
        entry.verdict = policy === "true"
            ? "explicit-continuation-observed-not-used-for-fork"
            : "no-execution-on-default-or-disabled-resume";
    });
}

async function fork(client, source, boundary) {
    const result = await client.rpc.sessions.fork({
        sessionId: source.id,
        ...(boundary === "earlier" ? { toEventId: source.boundary } : {}),
        name: `Synthetic contract ${report.runId}`,
    });
    assert.ok(result.sessionId && !ownedIds.has(result.sessionId));
    ownedIds.add(result.sessionId);
    return result.sessionId;
}

async function coldVerify(client, id, expected) {
    const resumed = await client.resumeSession(id, config);
    assert.deepEqual(conversation(await resumed.getEvents()), conversation(expected));
    const activity = await resumed.rpc.metadata.isProcessing();
    assert.equal(activity.processing, false);
    await resumed.disconnect();
}

async function inUse(client, id) {
    const result = await client.rpc.sessions.checkInUse({ sessionIds: [id] });
    return result.inUse.includes(id);
}

async function observeCase(scenario, boundary, action) {
    const entry = { scenario, boundary };
    report.cases.push(entry);
    try {
        await action(entry);
        entry.completed = true;
        console.log(JSON.stringify({
            scenario, boundary, verdict: entry.verdict,
            observations: entry.observations,
        }));
    } finally {
        for (const client of [...clients]) await stop(client);
        await save();
    }
}

async function verifyAfterStop(entry, source, before, childId, boundary) {
    for (const client of [...clients]) await stop(client);
    entry.afterShutdown = summary(await readEvents(source.id));
    entry.parentPreserved = preserved(before, await readEvents(source.id));
    const verifier = await start();
    try {
        await coldVerify(verifier, source.id, source.events);
        entry.parentColdResume = true;
    } catch (error) {
        entry.parentColdResume = false;
        entry.parentResumeError = error.message;
        assert.match(error.message, /no valid session\.start/);
    }
    if (childId) {
        const expected = await assertChild(source, childId, boundary);
        await coldVerify(verifier, childId, expected);
        entry.childCheckpointAndColdResume = true;
    }
}

async function simultaneousResume(boundary) {
    await observeCase("simultaneous-resume", boundary, async (entry) => {
        const source = await fixture();
        const first = await start();
        const second = await start();
        assert.equal(await inUse(first, source.id), false);
        assert.equal(await inUse(second, source.id), false);
        const attachments = await Promise.all([
            first.resumeSession(source.id, config), second.resumeSession(source.id, config),
        ]);
        entry.alreadyInUse = await Promise.all(attachments.map(async (session) =>
            (await session.rpc.metadata.snapshot()).alreadyInUse));
        entry.runtimeExclusiveAdmission = false;
        entry.forkCalls = 0;
        await verifyAfterStop(entry, source, source.events);
        assert.equal(entry.parentPreserved, true);
        assert.equal(entry.parentColdResume, true);
        entry.verdict = entry.alreadyInUse.includes(true)
            ? "both-resumes-accepted-warning-observed"
            : "both-resumes-accepted-without-warning";
    });
}

async function occupancyAfterRelease(releaseIndex) {
    await observeCase("live-occupancy-after-competing-release", `release-${releaseIndex}`, async (entry) => {
        const source = await fixture();
        const contenders = [await start(), await start()];
        const observer = await start();
        entry.preflight = await Promise.all(contenders.map((client) => inUse(client, source.id)));
        assert.deepEqual(entry.preflight, [false, false]);
        const attachments = await Promise.all(contenders.map((client) =>
            client.resumeSession(source.id, config)));
        entry.alreadyInUse = await Promise.all(attachments.map(async (session) =>
            (await session.rpc.metadata.snapshot()).alreadyInUse));
        entry.liveOccupancyWithBothLoaded = await Promise.all(
            contenders.map((client) => inUse(client, source.id)));
        entry.observerSeesBothLoaded = await inUse(observer, source.id);
        const remaining = 1 - releaseIndex;
        await attachments[releaseIndex].disconnect();
        await stop(contenders[releaseIndex]);
        const survivorEvents = await attachments[remaining].getEvents();
        assert.deepEqual(conversation(survivorEvents), conversation(source.events));
        entry.survivorResponds = true;
        entry.survivorProcessing = (await attachments[remaining].rpc.metadata.isProcessing()).processing;
        entry.survivorSeesOtherOwner = await inUse(contenders[remaining], source.id);
        entry.observerSeesSurvivor = await inUse(observer, source.id);
        entry.forkCalls = 0;
        await verifyAfterStop(entry, source, source.events);
        assert.equal(entry.parentPreserved, true);
        assert.equal(entry.parentColdResume, true);
        entry.verdict = entry.observerSeesSurvivor
            ? "live-survivor-visible-after-release"
            : "live-survivor-invisible-to-occupancy-check";
    });
}

async function guardedRace(boundary) {
    await observeCase("post-resume-guarded-fork-race", boundary, async (entry) => {
        const source = await fixture();
        const contenders = [await start(), await start()];
        const preflight = await Promise.all(contenders.map((client) => inUse(client, source.id)));
        assert.deepEqual(preflight, [false, false]);
        const attachments = await Promise.all(contenders.map((client) =>
            client.resumeSession(source.id, config)));
        entry.contenders = await Promise.all(contenders.map(async (client, index) => {
            const attachment = attachments[index];
            const result = { index };
            try {
                result.alreadyInUse = (await attachment.rpc.metadata.snapshot()).alreadyInUse;
                result.liveOtherOwner = await inUse(client, source.id);
                if (result.alreadyInUse || result.liveOtherOwner) {
                    result.outcome = "rejected";
                } else {
                    assert.equal((await attachment.rpc.metadata.isProcessing()).processing, false);
                    // Recheck at submission rather than treating the earlier snapshot as a lease.
                    if (await inUse(client, source.id)) {
                        result.outcome = "rejected";
                    } else {
                        result.childId = await fork(client, source, boundary);
                        result.outcome = "forked";
                    }
                }
            } finally {
                await attachment.disconnect();
            }
            return result;
        }));
        const children = entry.contenders.filter((result) => result.outcome === "forked");
        assert.ok(children.length <= 1, "This observed competing pair must not both pass admission");
        entry.forkCalls = children.length;
        await verifyAfterStop(entry, source, source.events, children[0]?.childId, boundary);
        assert.equal(entry.parentPreserved, true);
        assert.equal(entry.parentColdResume, true);
        entry.verdict = "observed-race-rejected-or-single-safe-fork";
        entry.continuousExclusiveLeaseProven = false;
    });
}

async function ownership(boundary, scenario) {
    await observeCase(scenario, boundary, async (entry) => {
        const source = await fixture();
        entry.sourceId = source.id;
        let caller;
        let owner;
        let attachment;
        if (scenario.startsWith("shared-")) {
            ({ owner, peer: caller } = await sharedRuntime());
            attachment = await owner.resumeSession(source.id, config);
            if (scenario === "shared-release-one") {
                await caller.resumeSession(source.id, config);
                await attachment.disconnect();
            } else if (scenario === "shared-release-last") {
                await attachment.disconnect();
            }
        } else {
            caller = await start();
            owner = await start();
            if (["check-then-resume-race", "reject-after-resume-warning"].includes(scenario)) {
                entry.preflightInUse = await inUse(caller, source.id);
                assert.equal(entry.preflightInUse, false);
            }
            attachment = await owner.resumeSession(source.id, config);
            entry.occupied = await inUse(caller, source.id);
            assert.equal(entry.occupied, true);
            if (["check-then-resume-race", "reject-after-resume-warning"].includes(scenario)) {
                try {
                    const acquired = await caller.resumeSession(source.id, config);
                    entry.resumeAccepted = true;
                    entry.resumeAlreadyInUse = (await acquired.rpc.metadata.snapshot()).alreadyInUse;
                    entry.callerSeesOtherOwner = await inUse(caller, source.id);
                    entry.ownerSeesOtherOwner = await inUse(owner, source.id);
                    assert.equal((await acquired.rpc.metadata.isProcessing()).processing, false);
                    assert.deepEqual(conversation(await attachment.getEvents()), conversation(source.events));
                    if (scenario === "reject-after-resume-warning") {
                        assert.equal(entry.resumeAlreadyInUse, true);
                        const before = await readEvents(source.id);
                        await acquired.disconnect();
                        await stop(caller);
                        assert.deepEqual(conversation(await attachment.getEvents()), conversation(source.events));
                        const ownerChildId = await fork(owner, source, boundary);
                        await verifyAfterStop(entry, source, before, ownerChildId, boundary);
                        assert.equal(entry.parentColdResume, true);
                        entry.verdict = "warning-detected-owner-still-usable";
                        return;
                    }
                } catch (error) {
                    if (scenario === "reject-after-resume-warning") throw error;
                    entry.resumeAccepted = false;
                    entry.resumeError = error.message;
                }
                entry.observations = { resumeAcceptedDespiteOtherOwner: entry.resumeAccepted };
            } else if (scenario === "occupied-admission-rejection") {
                const before = await readEvents(source.id);
                entry.forkCalls = 0;
                assert.ok(await inUse(caller, source.id));
                await verifyAfterStop(entry, source, before);
                assert.equal(entry.parentPreserved, true);
                assert.equal(entry.parentColdResume, true);
                entry.verdict = "guard-rejected-before-fork";
                return;
            }
        }
        const before = await readEvents(source.id);
        entry.before = summary(before);
        const childId = scenario === "check-then-resume-race" && !entry.resumeAccepted
            ? undefined : await fork(caller, source, boundary);
        entry.childId = childId;
        entry.immediateParentPreserved = preserved(before, await readEvents(source.id));
        await verifyAfterStop(entry, source, before, childId, boundary);
        if (["shared-loaded", "shared-release-one"].includes(scenario)) {
            assert.equal(entry.parentPreserved, true);
            assert.equal(entry.parentColdResume, true);
        }
        if (["shared-release-last", "raw-other-runtime"].includes(scenario)) {
            assert.equal(entry.immediateParentPreserved, false);
        }
        entry.verdict = scenario === "check-then-resume-race"
            ? entry.resumeAccepted ? "ownership-counterexample" : "runtime-rejected-competing-resume"
            : entry.immediateParentPreserved ? "passed" : "unsafe-path-reproduced";
    });
}

async function forceStop(client) {
    await client.forceStop();
    clients.delete(client);
}

async function transportFault(boundary, scenario) {
    await observeCase(scenario, boundary, async (entry) => {
        const source = await fixture();
        const { owner, port, connectionToken } = await sharedRuntime(false);
        await owner.resumeSession(source.id, config);
        const before = await readEvents(source.id);
        const proxy = await interceptFork({
            upstreamPort: port,
            ...(["process-exit-before-dispatch", "process-exit-in-flight"].includes(scenario) ? {
                onRequest: async ({ cut, forward }) => {
                    if (scenario === "process-exit-in-flight") {
                        forward();
                        entry.requestForwardedBeforeExit = true;
                        await new Promise((resolve) => setTimeout(resolve, 1));
                    }
                    await forceStop(owner);
                    cut();
                },
            } : {
                onResponse: async ({ cut }) => {
                    if (scenario === "process-exit-after-commit") await forceStop(owner);
                    cut();
                },
            }),
        });
        let caller;
        try {
            caller = await start(RuntimeConnection.forUri(`127.0.0.1:${proxy.port}`, { connectionToken }), true);
            const name = `operation-${randomUUID()}`;
            const request = {
                sessionId: source.id,
                ...(boundary === "earlier" ? { toEventId: source.boundary } : {}),
                name,
            };
            try {
                await bounded(caller.rpc.sessions.fork(request), "fork response after transport loss", 2000);
                assert.fail("The intercepted request must not deliver a successful result");
            } catch (error) {
                assert.notEqual(error.code, "ERR_ASSERTION");
                entry.clientError = error.message;
                entry.clientRequiredTimeout = error.message.startsWith("PROBE_TIMEOUT:");
            }
            entry.proxy = proxy.observed;
            assert.equal(proxy.observed.forkRequests, 1);
            assert.equal(proxy.observed.suppressedResponses,
                ["process-exit-before-dispatch", "process-exit-in-flight"].includes(scenario) ? 0 : 1);
            // Observer knowledge is an oracle, not a result available to a real disconnected caller.
            const oracleChildId = proxy.observed.runtimeResult?.sessionId;
            if (oracleChildId) ownedIds.add(oracleChildId);
            entry.forkRetries = 0;
            entry.deleteCalls = 0;
            await forceStop(caller);
            if (clients.has(owner)) await stop(owner);
            const verifier = await start();
            const listed = (await verifier.rpc.sessions.list({ source: "local" })).sessions;
            const candidateIds = listed.filter((item) => item.name === name).map((item) => item.sessionId);
            entry.candidatesFromNativeList = candidateIds;
            const parent = await readEvents(source.id);
            const backlinks = parent.filter((event) =>
                event.type === "session.info" && event.data.infoType === "fork" &&
                event.data.message.includes(name));
            entry.parentMatchingBacklinks = backlinks.map((event) => ({
                id: event.id, message: event.data.message,
            }));
            entry.parentPreserved = preserved(before, parent);
            assert.equal(entry.parentPreserved, true);
            await coldVerify(verifier, source.id, source.events);
            entry.parentColdResume = true;
            if (scenario === "process-exit-in-flight") {
                entry.candidateChecks = [];
                for (const childId of candidateIds) {
                    ownedIds.add(childId);
                    const candidate = { childId };
                    entry.candidateChecks.push(candidate);
                    try {
                        const expected = await assertChild(source, childId, boundary);
                        await coldVerify(verifier, childId, expected);
                        candidate.checkpointAndColdResume = true;
                    } catch (error) {
                        candidate.checkpointAndColdResume = false;
                        candidate.error = error.message;
                    }
                }
                entry.verdict = "in-flight-exit-results-observed-not-retried";
                entry.nativeMidWritePhaseKnown = false;
            } else if (oracleChildId) {
                assert.deepEqual(candidateIds, [oracleChildId]);
                assert.equal(backlinks.length, 1);
                assert.ok(backlinks[0].data.message.includes(oracleChildId));
                const expected = await assertChild(source, oracleChildId, boundary);
                await coldVerify(verifier, oracleChildId, expected);
                entry.childColdResume = true;
                entry.verdict = "unknown-to-caller-one-persisted-candidate";
            } else {
                assert.deepEqual(candidateIds, []);
                assert.deepEqual(backlinks, []);
                entry.verdict = "unknown-to-caller-no-persisted-candidate";
            }
            entry.uniqueOperationIdentityGuaranteedByRuntime = false;
            assert.deepEqual(proxy.faults, []);
        } finally {
            if (caller && clients.has(caller)) await forceStop(caller);
            await proxy.close();
        }
    });
}

async function duplicateFork(boundary) {
    await observeCase("duplicate-native-request", boundary, async (entry) => {
        const source = await fixture();
        const caller = await start();
        await caller.resumeSession(source.id, config);
        const before = await readEvents(source.id);
        const first = await fork(caller, source, boundary);
        const second = await fork(caller, source, boundary);
        assert.notEqual(first, second);
        entry.childIds = [first, second];
        entry.nativeForkIsIdempotent = false;
        entry.verdict = "duplicate-request-creates-two-children";
        await verifyAfterStop(entry, source, before, first, boundary);
        const verifier = [...clients][0];
        await coldVerify(verifier, second,
            boundary === "earlier" ? source.events.slice(0, 4) : source.events);
    });
}

async function integrityQuarantine(boundary) {
    await observeCase("integrity-anomaly-retain-child", boundary, async (entry) => {
        const source = await fixture();
        const caller = await start();
        const before = await readEvents(source.id);
        const childId = await fork(caller, source, boundary);
        assert.equal(preserved(before, await readEvents(source.id)), false);
        entry.integrityFailureDetected = true;
        entry.deleteCallsBeforeEvidenceCapture = 0;
        entry.automaticParentWrites = 0;
        const retained = await readEvents(childId);
        entry.childRecoveryEvidence = summary(retained);
        entry.damagedParentEvidence = summary(await readEvents(source.id));
        await verifyAfterStop(entry, source, before, childId, boundary);
        assert.equal(entry.parentColdResume, false);
        entry.childRetainedUntilGlobalSyntheticCleanup = true;
        entry.verdict = "recovery-material-retained-no-parent-rewrite";
    });
}

async function lockForDelete(file) {
    assert.equal(process.platform, "win32", "Delete-failure injection requires Windows FileShare.None");
    await writeFile(file, "Synthetic locked deletion sentinel");
    const holder = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        "$f = [System.IO.File]::Open($env:FORK_PROBE_LOCK_FILE, 'Open', 'Read', 'None'); " +
        "try { [Console]::WriteLine('LOCKED'); [Console]::ReadLine() | Out-Null } finally { $f.Dispose() }",
    ], { env: { ...process.env, FORK_PROBE_LOCK_FILE: file }, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    holder.stderr.on("data", (chunk) => { stderr += chunk; });
    const exited = new Promise((resolve, reject) => {
        holder.once("error", reject);
        holder.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Lock holder exited ${code}: ${stderr}`)));
    });
    await Promise.race([
        new Promise((resolve) => holder.stdout.on("data", (chunk) => {
            if (chunk.toString().includes("LOCKED")) resolve();
        })),
        exited.then(() => { throw new Error("Lock holder exited before acquiring lock"); }),
    ]);
    return async () => {
        holder.stdin.end("\n");
        await exited;
    };
}

async function deletionFailure(boundary) {
    await observeCase("native-delete-failure", boundary, async (entry) => {
        const source = await fixture();
        const caller = await start();
        await caller.resumeSession(source.id, config);
        const before = await readEvents(source.id);
        const childId = await fork(caller, source, boundary);
        entry.sourceId = source.id;
        entry.childId = childId;
        const release = await lockForDelete(path.join(path.dirname(journalPath(childId)), "deletion-blocker"));
        try {
            await assert.rejects(caller.deleteSession(childId), (error) => {
                entry.deleteError = error.message;
                return true;
            });
            entry.deleteAttemptsBeforeCleanup = 1;
            entry.forkRetries = 0;
            entry.childDirectoryAfterFailure = await readdir(path.dirname(journalPath(childId)));
            entry.rollbackComplete = false;
            entry.verdict = "rollback-incomplete-observable";
        } finally {
            await release();
        }
        await verifyAfterStop(entry, source, before);
        assert.equal(entry.parentPreserved, true);
        assert.equal(entry.parentColdResume, true);
    });
}

function lineageRecord(source, childId, boundary) {
    return {
        parentSessionId: source.id, childSessionId: childId,
        sourceUserEventId: source.events[boundary === "earlier" ? 1 : 4].id,
        sourceAssistantEventId: source.events[boundary === "earlier" ? 2 : 5].id,
        toEventId: boundary === "earlier" ? source.boundary : null,
        childForkMarkerEventId: null, siblingOrdinal: 1,
        createdAt: new Date().toISOString(),
    };
}

async function registration(boundary, scenario) {
    await observeCase(scenario, boundary, async (entry) => {
        const source = await fixture();
        const caller = await start();
        await caller.resumeSession(source.id, config);
        const before = await readEvents(source.id);
        const childId = await fork(caller, source, boundary);
        entry.sourceId = source.id;
        entry.childId = childId;
        const filePath = path.join(home, `lineage-${randomUUID()}.json`);
        const store = createLineageStore({ filePath });
        if (scenario === "registration-failure-rollback") {
            // A directory at the target file causes a real filesystem registration failure.
            await mkdir(filePath);
            await assert.rejects(store.recordFork(lineageRecord(source, childId, boundary)), (error) => {
                entry.registrationError = error.message;
                return ["EISDIR", "EACCES", "EPERM"].includes(error.code);
            });
            assert.ok(preserved(before, await readEvents(source.id)));
            assert.equal(await inUse(caller, childId), false);
            await caller.deleteSession(childId);
            await assert.rejects(readEvents(childId), { code: "ENOENT" });
            entry.childDeleted = true;
            const parentEvents = await readEvents(source.id);
            assert.ok(parentEvents.some((event) =>
                event.type === "session.info" && event.data.infoType === "fork" &&
                event.data.message.includes(childId)));
            entry.parentForkRecordRemains = true;
            await verifyAfterStop(entry, source, before);
            const verifier = [...clients][0];
            await verifier.resumeSession(source.id, config);
            const nextChild = await fork(verifier, source, boundary);
            assert.ok(preserved(before, await readEvents(source.id)));
            await verifyAfterStop(entry, source, before, nextChild, boundary);
            entry.subsequentForkPassed = true;
            entry.continuationModelCallVerified = false;
            entry.verdict = "passed";
        } else {
            let submissions = 0;
            try {
                submissions++;
                await store.recordFork(lineageRecord(source, childId, boundary));
                throw new Error("INJECTED: registration committed but acknowledgement lost");
            } catch (error) {
                assert.match(error.message, /^INJECTED:/);
                entry.injectedBoundary = error.message;
            }
            const index = await createLineageStore({ filePath }).read();
            const family = index.families[index.sessionToFamily[childId]];
            assert.equal(family.members[childId].parentSessionId, source.id);
            assert.equal(family.members[childId].toEventId,
                boundary === "earlier" ? source.boundary : null);
            entry.registrationConfirmedByReadback = true;
            entry.registrationSubmissions = submissions;
            entry.deleteCalls = 0;
            await verifyAfterStop(entry, source, before, childId, boundary);
            assert.equal(entry.parentPreserved, true);
            assert.equal(entry.parentColdResume, true);
            entry.verdict = "committed-result-reconciled-without-delete";
        }
    });
}

async function baseline(loaded, boundary) {
    const entry = { scenario: loaded ? "loaded" : "unloaded-negative-control", boundary };
    report.cases.push(entry);
    const caller = await start();
    const source = await fixture();
    entry.sourceId = source.id;
    if (loaded) await caller.resumeSession(source.id, config);
    const before = await readEvents(source.id);
    const childId = await fork(caller, source, boundary);
    entry.childId = childId;
    const after = await readEvents(source.id);
    entry.before = summary(before);
    entry.after = summary(after);
    entry.parentPreserved = preserved(before, after);
    const expected = await assertChild(source, childId, boundary);
    entry.childCheckpointCorrect = true;
    await stop(caller);
    assert.equal(preserved(before, await readEvents(source.id)), entry.parentPreserved);
    const verifier = await start();
    await coldVerify(verifier, childId, expected);
    entry.childColdResume = true;
    try {
        await coldVerify(verifier, source.id, source.events);
        entry.parentColdResume = true;
    } catch (error) {
        entry.parentColdResume = false;
        entry.parentResumeError = error.message;
        if (loaded) throw error;
        assert.match(error.message, /no valid session\.start/);
    }
    await stop(verifier);
    assert.equal(entry.parentPreserved, loaded);
    assert.equal(entry.parentColdResume, loaded);
    entry.verdict = loaded ? "passed" : "unsafe-path-reproduced";
    console.log(JSON.stringify({ scenario: entry.scenario, boundary, verdict: entry.verdict }));
}

try {
    if (mode === "pending-work") await calibrateModelSensor();
    for (let iteration = 1; iteration <= repeats; iteration++) {
        if (mode === "pending-work") {
            for (const kind of [
                "awaiting-assistant", "turn-started", "tool-requested", "tool-started",
                "external-tool-pending", "permission-pending",
            ]) {
                for (const policy of ["omitted", "false", "true"]) await pendingResume(kind, policy);
            }
            continue;
        }
        if (mode === "ownership-recheck") {
            await occupancyAfterRelease(0);
            await occupancyAfterRelease(1);
            continue;
        }
        for (const boundary of ["full", "earlier"]) {
            if (mode === "guarded-race") {
                await guardedRace(boundary);
                continue;
            }
            if (["baseline", "all"].includes(mode)) {
                await baseline(false, boundary);
                await baseline(true, boundary);
            }
            if (["boundaries", "all"].includes(mode)) {
                for (const scenario of [
                    "occupied-admission-rejection", "check-then-resume-race", "reject-after-resume-warning",
                    "raw-other-runtime", "shared-loaded", "shared-release-one", "shared-release-last",
                ]) await ownership(boundary, scenario);
                await simultaneousResume(boundary);
                for (const scenario of [
                    "registration-failure-rollback", "registration-acknowledgement-lost",
                ]) await registration(boundary, scenario);
            }
            if (["faults", "all"].includes(mode)) {
                for (const scenario of [
                    "connection-lost-after-commit", "process-exit-before-dispatch",
                    "process-exit-in-flight", "process-exit-after-commit",
                ]) await transportFault(boundary, scenario);
                await duplicateFork(boundary);
                await integrityQuarantine(boundary);
                await deletionFailure(boundary);
            }
        }
    }
} catch (error) {
    report.errors.push({ message: error.message, stack: error.stack });
    process.exitCode = 1;
} finally {
    for (const client of [...clients]) {
        try {
            await stop(client);
        } catch (error) {
            report.errors.push({ stage: "stop", message: error.message });
        }
    }
    let cleanupClient;
    try {
        cleanupClient = await start();
        const persistedIds = await readdir(path.join(home, "session-state"));
        for (const id of persistedIds) {
            if (id === ".session-operation-locks") continue;
            assert.match(id, /^[a-f0-9-]{36}$/);
            // Unknown fork results are safe to clean only because this entire home is synthetic.
            ownedIds.add(id);
            await cleanupClient.deleteSession(id);
            report.cleanup.push({ id, deleted: true });
        }
        report.remainingSessionDirectories = (await readdir(path.join(home, "session-state")))
            .filter((name) => name !== ".session-operation-locks");
        assert.deepEqual(report.remainingSessionDirectories, []);
    } catch (error) {
        report.errors.push({ stage: "delete", message: error.message });
    } finally {
        for (const client of [...clients]) {
            try {
                await stop(client);
            } catch (error) {
                report.errors.push({ stage: "cleanup-stop", message: error.message });
                await client.forceStop();
                clients.delete(client);
            }
        }
    }
    report.finishedAt = new Date().toISOString();
    report.ownedRuntimeClientsRemaining = clients.size;
    if (!clients.size && report.remainingSessionDirectories?.length === 0) {
        await rm(home, { recursive: true });
        report.temporaryHomeRemoved = true;
    } else {
        report.temporaryHomeRetained = home;
    }
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({
        cases: report.cases.length, errors: report.errors, output,
        cleanupComplete: report.temporaryHomeRemoved === true,
    }));
    if (report.errors.length || clients.size) process.exitCode = 1;
}
