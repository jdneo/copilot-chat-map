export function canForkSession(session) {
    return (
        typeof session.rpc.sessions?.fork === "function" ||
        typeof session.connection?.sendRequest === "function"
    );
}

export function forkSession(session, params) {
    if (typeof session.rpc.sessions?.fork === "function") {
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
