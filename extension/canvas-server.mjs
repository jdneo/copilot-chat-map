import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

import { renderHtml } from "./renderer.mjs";

const CONTENT_SECURITY_POLICY = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "connect-src 'self'",
    "img-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
].join("; ");
const MAX_REQUEST_BODY_BYTES = 4_096;

/**
 * @param {{
 *   loadSnapshot: () => Promise<object>,
 *   forkFromTurn: (request: object) => Promise<object>,
 *   openSession: (request: object) => Promise<object>
 * }} handlers
 * @returns {Promise<{ server: import("node:http").Server, url: string }>}
 */
export async function startCanvasServer({
    loadSnapshot,
    forkFromTurn,
    openSession,
}) {
    const token = randomBytes(32).toString("hex");
    const server = createServer(async (request, response) => {
        setSecurityHeaders(response);

        try {
            const url = new URL(request.url || "/", "http://127.0.0.1");
            if (url.searchParams.get("token") !== token) {
                sendText(response, 403, "Forbidden");
                return;
            }

            if (request.method === "GET" && url.pathname === "/") {
                response.writeHead(200, {
                    "Content-Type": "text/html; charset=utf-8",
                });
                response.end(renderHtml());
                return;
            }

            if (request.method === "GET" && url.pathname === "/api/state") {
                const snapshot = await loadSnapshot();
                response.writeHead(200, {
                    "Content-Type": "application/json; charset=utf-8",
                });
                response.end(JSON.stringify(snapshot));
                return;
            }

            if (request.method === "POST" && url.pathname === "/api/fork") {
                if (
                    !request.headers["content-type"]
                        ?.toLowerCase()
                        .startsWith("application/json")
                ) {
                    sendJson(response, 415, {
                        kind: "error",
                        message: "Fork requests must use application/json.",
                    });
                    return;
                }
                const result = await forkFromTurn(
                    await readJsonBody(request, "Fork"),
                );
                sendJson(response, statusForForkResult(result), result);
                return;
            }

            if (
                request.method === "POST" &&
                url.pathname === "/api/open-session"
            ) {
                if (
                    !request.headers["content-type"]
                        ?.toLowerCase()
                        .startsWith("application/json")
                ) {
                    sendJson(response, 415, {
                        kind: "error",
                        message: "Open Chat requests must use application/json.",
                    });
                    return;
                }
                const result = await openSession(
                    await readJsonBody(request, "Open Chat"),
                );
                sendJson(response, statusForOpenResult(result), result);
                return;
            }

            sendText(response, 404, "Not found");
        } catch (error) {
            const message =
                error instanceof Error ? error.message : "Unknown server error";
            const statusCode =
                error instanceof SyntaxError || error instanceof TypeError
                    ? 400
                    : 500;
            sendJson(response, statusCode, { kind: "error", message });
        }
    });

    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            server.off("error", reject);
            resolve(undefined);
        });
    });

    const address = server.address();
    if (!address || typeof address === "string") {
        await closeServer(server);
        throw new Error("Could not determine the canvas server address.");
    }

    return {
        server,
        url: `http://127.0.0.1:${address.port}/?token=${token}`,
    };
}

/**
 * @param {import("node:http").Server} server
 * @returns {Promise<void>}
 */
export function closeServer(server) {
    return new Promise((resolve, reject) => {
        server.close((error) => {
            if (error) reject(error);
            else resolve(undefined);
        });
    });
}

/** @param {import("node:http").ServerResponse} response */
function setSecurityHeaders(response) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {number} statusCode
 * @param {string} text
 */
function sendText(response, statusCode, text) {
    response.writeHead(statusCode, {
        "Content-Type": "text/plain; charset=utf-8",
    });
    response.end(text);
}

function sendJson(response, statusCode, value) {
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(value));
}

async function readJsonBody(request, operationName) {
    let size = 0;
    let body = "";
    request.setEncoding("utf8");
    for await (const chunk of request) {
        size += Buffer.byteLength(chunk);
        if (size > MAX_REQUEST_BODY_BYTES) {
            throw new TypeError(
                `${operationName} request exceeds ${MAX_REQUEST_BODY_BYTES} bytes.`,
            );
        }
        body += chunk;
    }
    if (!body) {
        throw new TypeError(`${operationName} request body is required.`);
    }
    return JSON.parse(body);
}

function statusForForkResult(result) {
    switch (result?.kind) {
        case "created":
            return 201;
        case "fork_failed":
            return 409;
        case "navigation_failed":
            return 502;
        case "lineage_failed":
            return 500;
        default:
            throw new TypeError("Fork service returned an unknown result.");
    }
}

function statusForOpenResult(result) {
    switch (result?.kind) {
        case "opened":
            return 200;
        case "navigation_failed":
            return 502;
        case "unavailable":
            return 409;
        default:
            throw new TypeError("Open Chat service returned an unknown result.");
    }
}
