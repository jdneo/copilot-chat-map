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
      width: min(340px, 100%);
      margin: 0 auto;
    }
    .turn {
      position: relative;
      margin-bottom: 18px;
      border: 1px solid var(--border-color-default, #30363d);
      border-radius: 10px;
      background: var(--background-color-muted, #161b22);
    }
    .turn.completed { border-color: var(--true-color-green, #3fb950); }
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

      if (state.turns.length === 0) {
        lane.append(element("div", "state", "No visible conversation turns yet."));
      }

      state.turns.forEach((turn) => {
        const completed = turn.status === "completed";
        const article = element("article", "turn " + turn.status);
        article.setAttribute("aria-label", completed ? "Completed turn" : "Incomplete turn");
        article.title = completed ? "Completed" : "Incomplete";
        const body = element("div", "turn-body collapsed");
        body.append(renderMessage("You", turn.userContent, "user"));
        body.append(renderMessage("Copilot", turn.assistantContent, "assistant"));
        article.append(body);

        const toggle = element("button", "turn-toggle", "Show more");
        toggle.type = "button";
        toggle.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
        toggle.addEventListener("click", () => {
          const expanded = !body.classList.toggle("collapsed");
          toggle.textContent = expanded ? "Show less" : "Show more";
          toggle.setAttribute("aria-expanded", String(expanded));
        });
        article.append(toggle);
        requestAnimationFrame(() => {
          toggle.hidden = body.scrollHeight <= body.clientHeight + 1;
        });

        lane.append(article);
      });

      content.replaceChildren(lane);
      status.hidden = true;
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
    refresh();
  </script>
</body>
</html>`;
}
