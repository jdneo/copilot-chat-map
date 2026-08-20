import { createReadStream } from "node:fs";
import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SESSION_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidLocalSessionId(sessionId) {
    return (
        typeof sessionId === "string" && SESSION_ID_PATTERN.test(sessionId)
    );
}

/**
 * @typedef {{
 *   platform?: NodeJS.Platform,
 *   env?: NodeJS.ProcessEnv,
 *   homedir?: string
 * }} EnvironmentOptions
 */

/**
 * @typedef {{
 *   platform: NodeJS.Platform,
 *   env: NodeJS.ProcessEnv,
 *   homedir: string
 * }} ResolvedEnvironment
 */

/**
 * @typedef {object} SessionEvent
 * @property {string} id
 * @property {string} type
 * @property {boolean} [ephemeral]
 * @property {string} [agentId]
 * @property {{
 *   agentId?: string,
 *   parentToolCallId?: string,
 *   source?: string,
 *   content?: string,
 *   toolRequests?: unknown[]
 * }} data
 */

/** @param {NodeJS.Platform} platform */
function pathApiFor(platform) {
    return platform === "win32" ? path.win32 : path.posix;
}

/** @param {ResolvedEnvironment} options */
function resolveSessionStateRoot({ platform, env, homedir }) {
    const pathApi = pathApiFor(platform);
    const copilotHome = env.COPILOT_HOME || pathApi.join(homedir, ".copilot");
    return pathApi.resolve(copilotHome, "session-state");
}

/**
 * @param {typeof path.win32} pathApi
 * @param {string} rootPath
 * @param {string} candidatePath
 */
function isContained(pathApi, rootPath, candidatePath) {
    const relativePath = pathApi.relative(rootPath, candidatePath);
    return (
        relativePath !== "" &&
        !relativePath.startsWith(`..${pathApi.sep}`) &&
        !pathApi.isAbsolute(relativePath)
    );
}

/**
 * @param {string} sessionId
 * @param {EnvironmentOptions} [options]
 */
export function resolveEventLogPath(
    sessionId,
    {
        platform = process.platform,
        env = process.env,
        homedir = os.homedir(),
    } = {},
) {
    if (!isValidLocalSessionId(sessionId)) {
        throw new TypeError(`Invalid local Copilot session ID: ${sessionId}`);
    }

    const pathApi = pathApiFor(platform);
    const sessionStateRoot = resolveSessionStateRoot({
        platform,
        env,
        homedir,
    });
    const eventLogPath = pathApi.resolve(
        sessionStateRoot,
        sessionId,
        "events.jsonl",
    );

    if (!isContained(pathApi, sessionStateRoot, eventLogPath)) {
        throw new TypeError(`Session path is outside session-state: ${sessionId}`);
    }

    return eventLogPath;
}

/**
 * @param {string} sessionId
 * @param {EnvironmentOptions} [options]
 * @returns {Promise<SessionEvent[]>}
 */
export async function readSessionEvents(
    sessionId,
    {
        platform = process.platform,
        env = process.env,
        homedir = os.homedir(),
    } = {},
) {
    const pathApi = pathApiFor(platform);
    const sessionStateRoot = resolveSessionStateRoot({
        platform,
        env,
        homedir,
    });
    const eventLogPath = resolveEventLogPath(sessionId, {
        platform,
        env,
        homedir,
    });
    const [realRootPath, realEventLogPath] = await Promise.all([
        realpath(sessionStateRoot),
        realpath(eventLogPath),
    ]);

    if (!isContained(pathApi, realRootPath, realEventLogPath)) {
        throw new TypeError(
            `Resolved session path is outside session-state: ${sessionId}`,
        );
    }

    return readJsonLines(realEventLogPath);
}

/**
 * @param {string} filePath
 * @returns {Promise<SessionEvent[]>}
 */
async function readJsonLines(filePath) {
    /** @type {SessionEvent[]} */
    const events = [];
    const stream = createReadStream(filePath, {
        encoding: "utf8",
        flags: "r",
    });
    let buffer = "";
    let lineNumber = 0;

    for await (const chunk of stream) {
        buffer += chunk;
        let newlineIndex = buffer.indexOf("\n");

        while (newlineIndex !== -1) {
            const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
            buffer = buffer.slice(newlineIndex + 1);
            lineNumber += 1;
            if (line.trim()) {
                events.push(parseEventLine(line, lineNumber));
            }
            newlineIndex = buffer.indexOf("\n");
        }
    }

    if (buffer.trim()) {
        try {
            events.push(JSON.parse(buffer.replace(/\r$/, "")));
        } catch (error) {
            if (!(error instanceof SyntaxError)) {
                throw error;
            }
        }
    }

    return events;
}

/**
 * @param {string} line
 * @param {number} lineNumber
 * @returns {SessionEvent}
 */
function parseEventLine(line, lineNumber) {
    try {
        return JSON.parse(line);
    } catch (error) {
        throw new SyntaxError(
            `Invalid Copilot event log JSON at line ${lineNumber}`,
            { cause: error },
        );
    }
}
