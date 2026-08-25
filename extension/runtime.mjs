export function canForkSession(session) {
    return (
        typeof session.rpc?.sessions?.fork === "function" ||
        typeof session.connection?.sendRequest === "function"
    );
}

export function canListSessions(session) {
    return (
        typeof session.rpc?.sessions?.list === "function" ||
        typeof session.connection?.sendRequest === "function"
    );
}

export function canCheckSessionsInUse(session) {
    return (
        typeof session.rpc?.sessions?.checkInUse === "function" ||
        typeof session.connection?.sendRequest === "function"
    );
}

export function forkSession(session, params) {
    if (typeof session.rpc?.sessions?.fork === "function") {
        return session.rpc.sessions.fork(params);
    }
    // CLI 1.0.80 keeps server-scoped RPCs on the joined session connection.
    if (typeof session.connection?.sendRequest === "function") {
        return session.connection.sendRequest("sessions.fork", params);
    }
    throw new Error(
        "Conversation Fork Map requires the experimental sessions.fork runtime capability.",
    );
}

export async function listLocalSessions(session) {
    const result = await serverRequest(session, "list", "sessions.list", {
        source: "local",
    });
    return result.sessions;
}

export async function checkSessionsInUse(session, sessionIds) {
    const result = await serverRequest(
        session,
        "checkInUse",
        "sessions.checkInUse",
        { sessionIds },
    );
    return new Set(result.inUse);
}

export async function navigateToSession(session, sessionId) {
    if (typeof session.rpc?.commands?.enqueue !== "function") {
        throw new Error("Host navigation is unavailable.");
    }

    const result = await session.rpc.commands.enqueue({
        command: `/resume ${sessionId}`,
    });
    if (result?.queued !== true) {
        throw new Error(
            "The host did not accept the session switch request.",
        );
    }
    return result;
}

function serverRequest(session, rpcMethod, wireMethod, params) {
    if (typeof session.rpc?.sessions?.[rpcMethod] === "function") {
        return session.rpc.sessions[rpcMethod](params);
    }
    if (typeof session.connection?.sendRequest === "function") {
        return session.connection.sendRequest(wireMethod, params);
    }
    throw new Error(
        `Conversation Fork Map requires the experimental ${wireMethod} runtime capability.`,
    );
}
