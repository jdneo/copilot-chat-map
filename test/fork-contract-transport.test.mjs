import assert from "node:assert/strict";
import { once } from "node:events";
import { connect, createServer } from "node:net";
import test from "node:test";
import { interceptFork, interceptRpc } from "../scripts/fork-contract-transport.mjs";

function frame(message) {
    const body = Buffer.from(JSON.stringify(message));
    return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}

function readFrame(socket) {
    return new Promise((resolve, reject) => {
        let pending = Buffer.alloc(0);
        const cleanup = () => {
            socket.off("data", receive);
            socket.off("error", fail);
            socket.off("close", closed);
        };
        const fail = (error) => { cleanup(); reject(error); };
        const closed = () => fail(new Error("Connection closed before a complete frame"));
        const receive = (chunk) => {
            pending = Buffer.concat([pending, chunk]);
            const headerEnd = pending.indexOf("\r\n\r\n");
            if (headerEnd < 0) return;
            const match = /Content-Length:\s*(\d+)/i.exec(pending.subarray(0, headerEnd).toString());
            if (!match) return fail(new Error("Missing frame length"));
            const frameEnd = headerEnd + 4 + Number(match[1]);
            if (pending.length < frameEnd) return;
            cleanup();
            try { resolve(JSON.parse(pending.subarray(headerEnd + 4, frameEnd).toString())); }
            catch (error) { reject(error); }
        };
        socket.on("data", receive);
        socket.on("error", fail);
        socket.on("close", closed);
    });
}

async function fixture(t, factory) {
    const requests = [];
    const faults = [];
    const sockets = new Set();
    const upstream = createServer((socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        readFrame(socket).then((request) => {
            requests.push(request);
            socket.write(frame({ jsonrpc: "2.0", id: request.id, result: { sessionId: "synthetic-child" } }));
        }).catch((error) => {
            if (error.message !== "Connection closed before a complete frame") faults.push(error);
        });
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const proxy = await factory(upstream.address().port);
    const caller = connect(proxy.port, "127.0.0.1");
    t.after(async () => {
        caller.destroy();
        await proxy.close();
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => upstream.close(resolve));
        assert.deepEqual(faults, []);
    });
    await once(caller, "connect");
    return { caller, proxy, requests };
}

test("fork wrapper forwards once and suppresses the real reply before cutting", { timeout: 5000 }, async (t) => {
    const { caller, proxy, requests } = await fixture(t, (upstreamPort) => interceptFork({
        upstreamPort, onRequest: ({ forward }) => forward(), onResponse: ({ cut }) => cut(),
    }));
    const closed = once(caller, "close");
    caller.write(frame({ jsonrpc: "2.0", id: 1, method: "sessions.fork", params: {} }));
    await closed;
    assert.equal(requests.length, 1);
    assert.equal(proxy.observed.forkRequests, 1);
    assert.equal(proxy.observed.suppressedResponses, 1);
    assert.deepEqual(proxy.observed.runtimeResult, { sessionId: "synthetic-child" });
});

test("generic fault responds to detach without forwarding either retry", { timeout: 5000 }, async (t) => {
    const { caller, proxy, requests } = await fixture(t, (upstreamPort) => interceptRpc({
        upstreamPort, method: "session.detach",
        onRequest: ({ respond }) => respond({ success: false, error: "Synthetic failure" }),
    }));
    for (const id of [1, 2]) {
        const reply = readFrame(caller);
        caller.write(frame({ jsonrpc: "2.0", id, method: "session.detach", params: {} }));
        assert.deepEqual(await reply, {
            jsonrpc: "2.0", id, result: { success: false, error: "Synthetic failure" },
        });
    }
    assert.equal(requests.length, 0);
    assert.equal(proxy.observed.forkRequests, 2);
});

test("unmatched RPCs pass through without invoking the fault", { timeout: 5000 }, async (t) => {
    const { caller, proxy, requests } = await fixture(t, (upstreamPort) => interceptRpc({
        upstreamPort, method: "session.send", onRequest: () => assert.fail("Unexpected interception"),
    }));
    const reply = readFrame(caller);
    caller.write(frame({ jsonrpc: "2.0", id: 3, method: "session.getMessages", params: {} }));
    assert.equal((await reply).result.sessionId, "synthetic-child");
    assert.equal(requests.length, 1);
    assert.equal(proxy.observed.forkRequests, 0);
});
