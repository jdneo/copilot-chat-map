import assert from "node:assert/strict";
import { connect, createServer } from "node:net";

// Only used with synthetic local runtimes. No request payload or connection token is retained.
export async function interceptFork({ upstreamPort, onRequest, onResponse }) {
    const sockets = new Set();
    const faults = [];
    const observed = { forkRequests: 0, suppressedResponses: 0 };
    let forkRequestId;
    const server = createServer((downstream) => {
        const upstream = connect(upstreamPort, "127.0.0.1");
        for (const socket of [downstream, upstream]) {
            sockets.add(socket);
            socket.on("close", () => sockets.delete(socket));
            socket.on("error", (error) => faults.push({ code: error.code, message: error.message }));
        }
        downstream.on("close", () => upstream.destroy());
        upstream.on("close", () => downstream.destroy());
        const cut = () => {
            downstream.destroy();
            upstream.destroy();
        };
        pipeFrames(downstream, async (message, frame) => {
            if (message.method === "sessions.fork") {
                forkRequestId = message.id;
                observed.forkRequests++;
                const forward = () => upstream.write(frame);
                if (onRequest) return onRequest({ forward, cut });
            }
            upstream.write(frame);
        });
        pipeFrames(upstream, async (message, frame) => {
            if (forkRequestId !== undefined && message.id === forkRequestId &&
                ("result" in message || "error" in message) && onResponse) {
                observed.suppressedResponses++;
                observed.runtimeResult = message.result;
                observed.runtimeError = message.error;
                await onResponse({ cut });
                return;
            }
            downstream.write(frame);
        });

        function pipeFrames(socket, receive) {
            let pending = Buffer.alloc(0);
            let chain = Promise.resolve();
            socket.on("data", (chunk) => {
                pending = Buffer.concat([pending, chunk]);
                while (true) {
                    const headerEnd = pending.indexOf("\r\n\r\n");
                    if (headerEnd < 0) break;
                    const match = /^Content-Length:\s*(\d+)/im.exec(pending.subarray(0, headerEnd).toString());
                    if (!match) {
                        faults.push({ message: "Expected JSON-RPC Content-Length framing" });
                        cut();
                        return;
                    }
                    const frameEnd = headerEnd + 4 + Number(match[1]);
                    if (pending.length < frameEnd) break;
                    const frame = pending.subarray(0, frameEnd);
                    pending = pending.subarray(frameEnd);
                    chain = chain.then(() => receive(
                        JSON.parse(frame.subarray(headerEnd + 4).toString()), frame,
                    )).catch((error) => {
                        faults.push({ message: error.message });
                        cut();
                    });
                }
            });
        }
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    return {
        port: server.address().port,
        observed,
        faults,
        async close() {
            for (const socket of sockets) socket.destroy();
            await new Promise((resolve, reject) =>
                server.close((error) => error ? reject(error) : resolve()));
            assert.equal(sockets.size, 0);
        },
    };
}
