import { isValidLocalSessionId } from "./event-reader.mjs";
import { navigateToSession } from "./runtime.mjs";

export function createOpenSessionService({
    getSession,
    loadSnapshot,
    navigate = navigateToSession,
}) {
    async function openSession(request) {
        const sessionId = request?.sessionId;
        if (!isValidLocalSessionId(sessionId)) {
            return {
                kind: "unavailable",
                message: "Open Chat requires a valid local session ID.",
            };
        }

        const snapshot = await loadSnapshot();
        if (snapshot.kind !== "ready") {
            return {
                kind: "unavailable",
                message: snapshot.message,
            };
        }
        const lane = snapshot.lanes.find(
            (candidate) => candidate.session.id === sessionId,
        );
        if (!lane?.session.available) {
            return {
                kind: "unavailable",
                sessionId,
                message: "This family session is no longer available locally.",
            };
        }
        if (lane.session.current) {
            return {
                kind: "opened",
                sessionId,
                navigation: "already_current",
            };
        }

        try {
            await navigate(getSession(), sessionId);
            return { kind: "opened", sessionId, navigation: "requested" };
        } catch (error) {
            const detail = error instanceof Error ? ` ${error.message}` : "";
            return {
                kind: "navigation_failed",
                sessionId,
                message: `Could not open this chat.${detail} Open it manually from the session list.`,
            };
        }
    }

    return { openSession };
}
