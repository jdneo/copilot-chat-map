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
    h1, h2, h3, p { margin: 0; }
    h1 {
      font-size: var(--text-title-medium, 20px);
      line-height: var(--leading-title-medium, 26px);
    }
    #status { color: var(--text-color-muted, #8b949e); }
    main { padding: 24px; }
    .state {
      max-width: 680px;
      margin: 48px auto;
      padding: 20px;
      border: 1px solid var(--border-color-default, #30363d);
      border-radius: 10px;
      background: var(--background-color-muted, #161b22);
    }
    .lane {
      position: relative;
      width: min(680px, 100%);
      margin: 0 auto;
      padding-left: 30px;
    }
    .lane::before {
      position: absolute;
      top: 70px;
      bottom: 18px;
      left: 9px;
      width: 2px;
      background: var(--border-color-default, #30363d);
      content: "";
    }
    .lane-header {
      margin-bottom: 18px;
      padding: 14px 16px;
      border: 1px solid var(--color-focus-outline, #2f81f7);
      border-radius: 10px;
      background: var(--background-color-muted, #161b22);
    }
    .meta, .turn-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .meta { margin-top: 5px; color: var(--text-color-muted, #8b949e); }
    .badge {
      display: inline-flex;
      border-radius: 999px;
      padding: 2px 8px;
      background: var(--true-color-blue-muted, #1f6feb33);
      color: var(--true-color-blue, #58a6ff);
      font-size: 12px;
      font-weight: var(--font-weight-semibold, 600);
      white-space: nowrap;
    }
    .badge.incomplete {
      background: var(--true-color-red-muted, #f8514933);
      color: var(--true-color-red, #ff7b72);
    }
    .turn {
      position: relative;
      margin-bottom: 18px;
      overflow: hidden;
      border: 1px solid var(--border-color-default, #30363d);
      border-radius: 10px;
      background: var(--background-color-muted, #161b22);
    }
    .turn::before {
      position: absolute;
      top: 20px;
      left: -27px;
      width: 12px;
      height: 12px;
      border: 3px solid var(--background-color-default, #0d1117);
      border-radius: 50%;
      background: var(--color-focus-outline, #2f81f7);
      content: "";
    }
    .turn-heading { padding: 10px 14px; }
    .message { padding: 12px 14px 14px; border-top: 1px solid var(--border-color-default, #30363d); }
    .message.user { border-left: 4px solid var(--true-color-blue, #58a6ff); }
    .message.assistant { border-left: 4px solid var(--true-color-green, #3fb950); }
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
  <main id="content" aria-live="polite"></main>
  <script>
    const content = document.querySelector("#content");
    const refreshButton = document.querySelector("#refresh");
    const status = document.querySelector("#status");
    const token = new URLSearchParams(window.location.search).get("token") || "";

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

    function renderReady(state) {
      const lane = element("section", "lane");
      const laneHeader = element("div", "lane-header");
      laneHeader.append(element("h2", "", state.session.title));
      const meta = element("div", "meta");
      meta.append(element("span", "", state.turns.length + (state.turns.length === 1 ? " turn" : " turns")));
      meta.append(element("span", "badge", "Current session"));
      laneHeader.append(meta);
      lane.append(laneHeader);

      if (state.turns.length === 0) {
        lane.append(element("div", "state", "No visible conversation turns yet."));
      }

      state.turns.forEach((turn, index) => {
        const article = element("article", "turn");
        const heading = element("div", "turn-heading");
        heading.append(element("h3", "", "Turn " + (index + 1)));
        heading.append(element("span", "badge " + (turn.status === "completed" ? "" : "incomplete"), turn.status === "completed" ? "Completed" : "Incomplete"));
        article.append(heading);
        article.append(renderMessage("You", turn.userContent, "user"));
        article.append(renderMessage("Copilot", turn.assistantContent, "assistant"));
        lane.append(article);
      });

      content.replaceChildren(lane);
      status.textContent = "Read-only current session";
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
      status.textContent = state.kind === "unsupported" ? "Unsupported session" : "Load error";
    }

    async function refresh() {
      refreshButton.disabled = true;
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
    refresh();
  </script>
</body>
</html>`;
}
