export function renderHtml() {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Conversation Fork Map</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--text-body-medium, 14px);
      line-height: var(--leading-body-medium, 20px);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--background-color-default, #0d1117);
      color: var(--text-color-default, #f0f6fc);
    }
    button {
      border: 1px solid var(--border-color-default, #30363d);
      border-radius: 6px;
      padding: 6px 12px;
      background: var(--background-color-muted, #21262d);
      color: inherit;
      font: inherit;
      font-weight: var(--font-weight-semibold, 600);
      cursor: pointer;
    }
    button:focus-visible {
      outline: 2px solid var(--color-focus-outline, #2f81f7);
      outline-offset: 2px;
    }
    button:disabled { cursor: wait; opacity: .65; }
    header {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-color-default, #30363d);
      background: var(--background-color-default, #0d1117);
    }
    h1, h2, p { margin: 0; }
    h1 {
      font-size: var(--text-title-medium, 20px);
      line-height: var(--leading-title-medium, 26px);
    }
    #status { color: var(--text-color-muted, #8b949e); }
    main { padding: 24px; }
    #notice {
      max-width: 680px;
      margin: 0 auto 20px;
      padding: 12px 14px;
      border: 1px solid var(--border-color-default, #30363d);
      border-radius: 8px;
      background: var(--background-color-muted, #161b22);
    }
    #notice.error { border-color: var(--danger-color-emphasis, #f85149); }
    #notice strong { display: block; margin-bottom: 4px; }
    .state {
      max-width: 680px;
      margin: 48px auto;
      padding: 20px;
      border: 1px solid var(--border-color-default, #30363d);
      border-radius: 10px;
      background: var(--background-color-muted, #161b22);
    }
    .family {
      display: flex;
      align-items: flex-start;
      gap: 48px;
      min-width: min-content;
      overflow-x: auto;
      padding: 2px;
    }
    .lane {
      position: relative;
      width: min(340px, 100%);
      min-width: min(340px, calc(100vw - 48px));
    }
    .lane.current {
      filter: drop-shadow(0 0 8px color-mix(in srgb, var(--true-color-blue, #58a6ff) 32%, transparent));
    }
    .lane-header {
      margin-bottom: 18px;
      padding: 12px;
      border: 1px solid var(--border-color-default, #30363d);
      border-radius: 10px;
      background: var(--background-color-muted, #161b22);
    }
    .lane.current > .lane-header {
      border-color: var(--true-color-blue, #58a6ff);
    }
    .lane-heading {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .lane-heading h2 {
      overflow-wrap: anywhere;
      font-size: 16px;
      line-height: 22px;
    }
    .lane-badge {
      flex: none;
      color: var(--true-color-blue, #58a6ff);
      font-size: 12px;
      font-weight: var(--font-weight-semibold, 600);
    }
    .lane-meta {
      margin-top: 7px;
      color: var(--text-color-muted, #8b949e);
      font-size: 12px;
    }
    .lane-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-top: 10px;
    }
    .checkpoint-link {
      border: 0;
      padding: 0;
      background: transparent;
      color: var(--true-color-blue, #58a6ff);
      font-size: 12px;
    }
    .checkpoint-link:disabled {
      color: var(--text-color-muted, #8b949e);
      cursor: not-allowed;
      opacity: 1;
    }
    .open-chat {
      margin-left: auto;
      white-space: nowrap;
    }
    .turn {
      position: relative;
      margin-bottom: 18px;
      border: 1px solid var(--border-color-default, #30363d);
      border-radius: 10px;
      background: var(--background-color-muted, #161b22);
    }
    .turn.completed {
      border-color: var(--true-color-green, #3fb950);
      cursor: pointer;
    }
    .turn.completed:hover { border-color: var(--true-color-blue, #58a6ff); }
    .turn.completed.selected {
      border-color: var(--true-color-blue, #58a6ff);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--true-color-blue, #58a6ff) 35%, transparent);
    }
    .turn.incomplete {
      border-color: var(--border-color-default, #30363d);
      border-style: dashed;
    }
    .turn + .turn::before {
      position: absolute;
      top: -19px;
      left: 50%;
      width: 2px;
      height: 18px;
      transform: translateX(-50%);
      background: var(--border-color-default, #30363d);
      content: "";
    }
    .message { padding: 9px 12px 10px; border-top: 1px solid var(--border-color-default, #30363d); }
    .message:first-child { border-top: 0; }
    .role {
      margin-bottom: 6px;
      color: var(--text-color-muted, #8b949e);
      font-size: 12px;
      font-weight: var(--font-weight-semibold, 600);
      text-transform: uppercase;
      letter-spacing: .04em;
    }
    .content {
      margin: 0;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
      font: inherit;
    }
    .turn-body.collapsed {
      max-height: 240px;
      overflow: hidden;
    }
    .turn-toggle {
      width: 100%;
      border: 0;
      border-top: 1px solid var(--border-color-default, #30363d);
      border-radius: 0 0 10px 10px;
      padding: 6px 12px;
      background: var(--background-color-muted, #161b22);
      color: var(--true-color-blue, #58a6ff);
      font-size: 12px;
      font-weight: var(--font-weight-semibold, 600);
      text-align: center;
    }
    .turn-toggle:hover {
      background: var(--background-color-default, #0d1117);
    }
    .turn-toggle:focus-visible {
      border: 0;
      border-top: 1px solid var(--border-color-default, #30363d);
    }
    .branch-button {
      position: absolute;
      top: 50%;
      left: calc(100% + 10px);
      width: max-content;
      transform: translateY(-50%);
      border-radius: 999px;
      background: var(--true-color-blue, #1f6feb);
      color: #fff;
    }
    .turn:not(.selected) > .branch-button { display: none; }
    .empty { color: var(--text-color-muted, #8b949e); font-style: italic; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Conversation Fork Map</h1>
      <p id="status">Loading current session...</p>
    </div>
    <button id="refresh" type="button">Refresh</button>
  </header>
  <aside id="notice" role="status" hidden></aside>
  <main id="content" aria-live="polite"></main>
  <script>
    const content = document.querySelector("#content");
    const refreshButton = document.querySelector("#refresh");
    const status = document.querySelector("#status");
    const notice = document.querySelector("#notice");
    const token = new URLSearchParams(window.location.search).get("token") || "";
    const operationIdsByTurn = new Map();
    const blockedTurns = new Set();
    let currentState;
    let forkPending = false;
    let availabilityError = "";
    let focusedSessionId = "";

    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function renderMessage(role, text, className) {
      const section = element("section", "message " + className);
      section.append(element("div", "role", role));
      section.append(element("pre", "content" + (text ? "" : " empty"), text || "Waiting for Copilot's final response."));
      return section;
    }

    function showNotice(title, message, isError) {
      notice.className = isError ? "error" : "";
      notice.replaceChildren(
        element("strong", "", title),
        element("span", "", message),
      );
      notice.hidden = false;
    }

    function selectTurn(article) {
      document.querySelector(".turn.selected")?.classList.remove("selected");
      document.querySelectorAll(".turn").forEach((turn) => {
        turn.setAttribute("aria-selected", "false");
      });
      article.classList.add("selected");
      article.setAttribute("aria-selected", "true");
    }

    function updateBranchControls() {
      document.querySelectorAll(".branch-button").forEach((button) => {
        button.disabled =
          !currentState?.canFork ||
          forkPending ||
          blockedTurns.has(button.dataset.turnId);
      });
    }

    function renderForkAvailability() {
      status.hidden = !availabilityError && currentState?.canFork !== false;
      status.textContent = availabilityError ||
        (currentState?.canFork === false
          ? "Branching is disabled while the agent is working."
          : "");
      updateBranchControls();
    }

    async function refreshForkAvailability() {
      try {
        const response = await fetch("/api/state?token=" + encodeURIComponent(token), {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("Activity request failed with status " + response.status);
        }
        const state = await response.json();
        if (
          state.kind === "ready" &&
          currentState?.kind === "ready" &&
          state.session.id === currentState.session.id
        ) {
          availabilityError = "";
          currentState.canFork = state.canFork;
          renderForkAvailability();
        }
      } catch (error) {
        availabilityError =
          error instanceof Error
            ? "Could not check agent activity: " + error.message
            : "Could not check agent activity.";
        if (currentState?.kind === "ready") currentState.canFork = false;
        renderForkAvailability();
      }
    }

    async function createBranch(turn) {
      if (forkPending || blockedTurns.has(turn.id) || !currentState?.canFork) return;
      forkPending = true;
      const operationId = operationIdsByTurn.get(turn.id) || crypto.randomUUID();
      operationIdsByTurn.set(turn.id, operationId);
      updateBranchControls();
      showNotice("Creating branch", "Creating a child session at this checkpoint...", false);

      try {
        const response = await fetch("/api/fork?token=" + encodeURIComponent(token), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operationId,
            sessionId: currentState.session.id,
            turnId: turn.id,
          }),
        });
        const result = await response.json();
        if (result.kind === "created") {
          blockedTurns.add(turn.id);
          showNotice("Branch created", "Opening " + result.name + "...", false);
          setTimeout(() => {
            blockedTurns.delete(turn.id);
            operationIdsByTurn.delete(turn.id);
            updateBranchControls();
          }, 10000);
        } else if (result.kind === "lineage_failed") {
          blockedTurns.add(turn.id);
          showNotice("Branch created without lineage", result.message, true);
        } else if (result.kind === "navigation_failed") {
          blockedTurns.add(turn.id);
          showNotice(
            "Branch ready",
            result.message ||
              ("Child session " + result.childSessionId + " is ready. Open it manually from the session list."),
            true,
          );
        } else {
          operationIdsByTurn.delete(turn.id);
          showNotice("Could not create branch", result.message || "The fork request failed.", true);
          await refreshForkAvailability();
        }
      } catch (error) {
        showNotice(
          "Could not create branch",
          error instanceof Error ? error.message : "Unknown fork error.",
          true,
        );
      } finally {
        forkPending = false;
        updateBranchControls();
      }
    }

    async function openChat(sessionId) {
      showNotice("Opening chat", "Requesting a switch to the selected session...", false);
      try {
        const response = await fetch("/api/open-session?token=" + encodeURIComponent(token), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        const result = await response.json();
        if (result.kind === "opened") {
          showNotice("Opening chat", "The host is switching to the selected session.", false);
          return;
        }
        showNotice(
          "Could not open chat",
          result.message || "Open this session manually from the session list.",
          true,
        );
      } catch (error) {
        showNotice(
          "Could not open chat",
          (error instanceof Error ? error.message + " " : "") +
            "Open this session manually from the session list.",
          true,
        );
      }
    }

    function focusCheckpoint(checkpoint) {
      const turn = Array.from(document.querySelectorAll(".turn")).find(
        (candidate) =>
          candidate.dataset.sessionId === checkpoint.sessionId &&
          candidate.dataset.turnId === checkpoint.turnId,
      );
      if (!turn) {
        showNotice(
          "Fork Checkpoint unavailable",
          "The source turn could not be found in the parent session.",
          true,
        );
        return;
      }
      selectTurn(turn);
      turn.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }

    function renderLane(state, laneState) {
      const lane = element(
        "section",
        "lane" + (laneState.session.current ? " current" : ""),
      );
      lane.dataset.sessionId = laneState.session.id;

      const header = element("div", "lane-header");
      const heading = element("div", "lane-heading");
      heading.append(element("h2", "", laneState.session.title));
      if (laneState.session.current) {
        heading.append(element("span", "lane-badge", "Current Session"));
      }
      header.append(heading);

      const details = [];
      if (laneState.session.summary && laneState.session.summary !== laneState.session.title) {
        details.push(laneState.session.summary);
      }
      if (laneState.session.modifiedTime) {
        const modified = new Date(laneState.session.modifiedTime);
        if (!Number.isNaN(modified.valueOf())) details.push("Modified " + modified.toLocaleString());
      }
      if (!laneState.session.available) details.push("Session unavailable");
      if (details.length) header.append(element("p", "lane-meta", details.join(" · ")));

      const actions = element("div", "lane-actions");
      if (laneState.sourceCheckpoint) {
        const checkpoint = element(
          "button",
          "checkpoint-link",
          laneState.inheritedTurnCount +
            " inherited " +
            (laneState.inheritedTurnCount === 1 ? "turn" : "turns") +
            " · Fork Checkpoint",
        );
        checkpoint.type = "button";
        checkpoint.disabled = !laneState.sourceCheckpoint.available;
        checkpoint.addEventListener("click", () =>
          focusCheckpoint(laneState.sourceCheckpoint),
        );
        actions.append(checkpoint);
      }
      if (!laneState.session.current) {
        const openButton = element("button", "open-chat", "Open Chat");
        openButton.type = "button";
        openButton.disabled = !laneState.session.available;
        openButton.addEventListener("click", () => openChat(laneState.session.id));
        actions.append(openButton);
      }
      if (actions.childElementCount) header.append(actions);
      lane.append(header);

      if (laneState.turns.length === 0) {
        lane.append(
          element(
            "div",
            "state",
            laneState.session.available
              ? "No post-fork conversation turns yet."
              : "Session unavailable.",
          ),
        );
      }

      laneState.turns.forEach((turn) => {
        const completed = turn.status === "completed";
        const article = element("article", "turn " + turn.status);
        article.dataset.sessionId = laneState.session.id;
        article.dataset.turnId = turn.id;
        article.setAttribute("aria-label", completed ? "Completed turn" : "Incomplete turn");
        article.setAttribute("aria-selected", "false");
        article.title = completed ? "Completed" : "Incomplete";
        const body = element("div", "turn-body collapsed");
        body.append(renderMessage("You", turn.userContent, "user"));
        body.append(renderMessage("Copilot", turn.assistantContent, "assistant"));
        article.append(body);

        const toggle = element("button", "turn-toggle", "Show more");
        toggle.type = "button";
        toggle.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
        toggle.addEventListener("click", (event) => {
          event.stopPropagation();
          const expanded = !body.classList.toggle("collapsed");
          toggle.textContent = expanded ? "Show less" : "Show more";
          toggle.setAttribute("aria-expanded", String(expanded));
        });
        article.append(toggle);
        requestAnimationFrame(() => {
          toggle.hidden = body.scrollHeight <= body.clientHeight + 1;
        });

        if (completed && laneState.session.current) {
          const branchButton = element("button", "branch-button", "+ New branch");
          branchButton.type = "button";
          branchButton.dataset.turnId = turn.id;
          branchButton.addEventListener("click", (event) => {
            event.stopPropagation();
            createBranch(turn);
          });
          article.append(branchButton);
        }
        if (completed) {
          article.addEventListener("click", () => selectTurn(article));
        }

        lane.append(article);
      });
      return lane;
    }

    function renderReady(state) {
      currentState = state;
      availabilityError = "";
      const family = element("section", "family");
      const lanes = state.lanes || [{
        session: { ...state.session, current: true, available: true },
        sourceCheckpoint: null,
        inheritedTurnCount: 0,
        turns: state.turns,
      }];
      lanes.forEach((lane) => family.append(renderLane(state, lane)));
      content.replaceChildren(family);
      if (focusedSessionId !== state.currentSessionId) {
        focusedSessionId = state.currentSessionId;
        requestAnimationFrame(() => {
          document.querySelector(".lane.current")?.scrollIntoView({
            block: "nearest",
            inline: "center",
          });
        });
      }
      renderForkAvailability();
    }

    function renderState(state) {
      if (state.kind === "ready") {
        renderReady(state);
        return;
      }
      const panel = element("section", "state");
      panel.append(element("h2", "", state.kind === "unsupported" ? "Unavailable" : "Could not load map"));
      panel.append(element("p", "", state.message));
      content.replaceChildren(panel);
      currentState = undefined;
      status.hidden = false;
      status.textContent = state.kind === "unsupported" ? "Unsupported session" : "Load error";
    }

    async function refresh() {
      refreshButton.disabled = true;
      status.hidden = false;
      status.textContent = "Refreshing...";
      try {
        const response = await fetch("/api/state?token=" + encodeURIComponent(token), { cache: "no-store" });
        if (!response.ok) throw new Error("State request failed with status " + response.status);
        renderState(await response.json());
      } catch (error) {
        renderState({ kind: "error", message: error instanceof Error ? error.message : "Unknown refresh error." });
      } finally {
        refreshButton.disabled = false;
      }
    }

    refreshButton.addEventListener("click", refresh);
    setInterval(refreshForkAvailability, 2500);
    refresh();
  </script>
</body>
</html>`;
}
