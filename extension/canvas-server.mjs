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

/**
 * @param {() => Promise<object>} loadSnapshot
 * @returns {Promise<{ server: import("node:http").Server, url: string }>}
 */
export async function startCanvasServer(loadSnapshot) {
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

            sendText(response, 404, "Not found");
        } catch (error) {
            const message =
                error instanceof Error ? error.message : "Unknown server error";
            response.writeHead(500, {
                "Content-Type": "application/json; charset=utf-8",
            });
            response.end(JSON.stringify({ kind: "error", message }));
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
