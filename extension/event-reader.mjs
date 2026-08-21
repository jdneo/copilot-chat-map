import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SESSION_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const eventLogCache = new Map();

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

    const fileStat = await stat(realEventLogPath);
    const identity = [
        fileStat.dev,
        fileStat.ino,
        fileStat.birthtimeMs,
    ].join(":");
    const cached = eventLogCache.get(realEventLogPath);
    const canAppend =
        cached?.identity === identity &&
        fileStat.size >= cached.offset &&
        (fileStat.size > cached.offset ||
            fileStat.mtimeMs === cached.mtimeMs);
    const base = canAppend
        ? cached
        : {
              identity,
              offset: 0,
              mtimeMs: 0,
              lineNumber: 0,
              buffer: "",
              events: [],
          };
    if (fileStat.size === base.offset) {
        return base.events.slice();
    }
    const parsed = await readJsonLines(realEventLogPath, base, fileStat.size);
    const next = {
        ...parsed,
        identity,
        offset: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
    };
    eventLogCache.set(realEventLogPath, next);
    return next.events.slice();
}

/**
 * @param {string} filePath
 * @param {{
 *   offset: number,
 *   lineNumber: number,
 *   buffer: string,
 *   events: SessionEvent[]
 * }} base
 * @param {number} size
 */
async function readJsonLines(filePath, base, size) {
    const events = base.events.slice();
    const stream = createReadStream(filePath, {
        encoding: "utf8",
        flags: "r",
        start: base.offset,
        end: size - 1,
    });
    let buffer = base.buffer;
    let lineNumber = base.lineNumber;

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
            lineNumber += 1;
            buffer = "";
        } catch (error) {
            if (!(error instanceof SyntaxError)) {
                throw error;
            }
        }
    }

    return { events, buffer, lineNumber };
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
