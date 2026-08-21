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
    h2, p { margin: 0; }
    #status {
      position: fixed;
      bottom: 20px;
      left: 20px;
      z-index: 3;
      max-width: calc(100vw - 96px);
      padding: 7px 10px;
      border: 1px solid var(--border-color-default, #30363d);
      border-radius: 999px;
      background: var(--background-color-muted, #161b22);
      color: var(--text-color-muted, #8b949e);
      box-shadow: 0 4px 14px rgb(0 0 0 / 25%);
    }
    #refresh {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 3;
      display: grid;
      width: 42px;
      height: 42px;
      place-items: center;
      padding: 0;
      border-color: #58a6ff;
      border-radius: 50%;
      background: #1f6feb;
      color: #fff;
      box-shadow: 0 4px 14px rgb(0 0 0 / 30%);
    }
    #refresh:hover { background: #388bfd; }
    #refresh svg {
      width: 20px;
      height: 20px;
      stroke: #fff;
    }
    #refresh:disabled svg { animation: refresh-spin .8s linear infinite; }
    @keyframes refresh-spin { to { transform: rotate(360deg); } }
    main { padding: 24px 24px 82px; }
    #notice {
      position: fixed;
      top: 16px;
      left: 50%;
      z-index: 4;
      width: min(680px, calc(100vw - 32px));
      max-width: 680px;
      margin: 0;
      padding: 12px 14px;
      border: 1px solid var(--border-color-default, #30363d);
      border-radius: 8px;
      background: var(--background-color-muted, #161b22);
      box-shadow: 0 6px 24px rgb(0 0 0 / 35%);
      transform: translateX(-50%);
    }
    #notice.error { border-color: var(--danger-color-emphasis, #f85149); }
    #notice strong { display: block; margin-bottom: 4px; }
    .notice-close {
      position: absolute;
      top: 6px;
      right: 6px;
      border: 0;
      padding: 4px 8px;
      background: transparent;
      color: var(--text-color-muted, #8b949e);
      font-size: 12px;
    }
    .notice-close:hover { color: var(--text-color-default, #f0f6fc); }
    .state {
      max-width: 680px;
      margin: 48px auto;
      padding: 20px;
      border: 1px solid var(--border-color-default, #30363d);
      border-radius: 10px;
      background: var(--background-color-muted, #161b22);
    }
    .family {
      position: relative;
      display: flex;
      align-items: flex-start;
      gap: 48px;
      min-width: min-content;
      overflow-x: auto;
      padding: 2px 90px 2px 2px;
    }
    .lane {
      position: relative;
      z-index: 1;
      width: min(340px, 100%);
      min-width: min(340px, calc(100vw - 48px));
    }
    .branch-connections {
      position: absolute;
      top: 0;
      left: 0;
      z-index: 0;
      overflow: visible;
      pointer-events: none;
    }
    .branch-connection {
      fill: none;
      stroke: var(--border-color-default, #30363d);
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
      vector-effect: non-scaling-stroke;
    }
    .branch-connection.pending {
      stroke-dasharray: 6 5;
    }
    .lane-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 18px;
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
    .turn.virtual {
      min-height: 92px;
      padding: 12px;
      border-style: dashed;
      color: var(--text-color-muted, #8b949e);
    }
    .virtual-copy { font-style: italic; }
    .turn.virtual .lane-actions {
      margin: 10px 0 0;
    }
    .turn + .turn::before,
    .branch-entry + .turn::before {
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
    .message:first-child { border-top: 0; border-radius: 9px 9px 0 0; }
    .message:last-child { border-radius: 0 0 9px 9px; }
    .message.user { background: color-mix(in srgb, var(--true-color-blue, #58a6ff) 6%, transparent); }
    .message.assistant {
      background: var(--background-color-default, Canvas);
      color: var(--text-color-default, CanvasText);
    }
    .content {
      margin: 0;
      overflow-wrap: anywhere;
      white-space: normal;
    }
    .content.collapsed {
      display: -webkit-box;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: var(--line-clamp);
    }
    .content p,
    .content pre,
    .content ul,
    .content ol,
    .content table,
    .content h1,
    .content h2,
    .content h3,
    .content h4,
    .content h5,
    .content h6 { margin: 0 0 8px; }
    .content > :last-child { margin-bottom: 0; }
    .content ul, .content ol { padding-left: 22px; }
    .content table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .content th, .content td {
      padding: 4px 6px;
      border: 1px solid var(--border-color-default, #30363d);
      text-align: left;
      vertical-align: top;
    }
    .content code {
      border-radius: 4px;
      padding: 1px 4px;
      background: var(--background-color-default, #0d1117);
      font-family: var(--font-mono, ui-monospace, SFMono-Regular, Consolas, monospace);
      font-size: .92em;
    }
    .content .markdown-strong { font-weight: 700; }
    .content .code-block {
      overflow-x: auto;
      padding: 9px 10px;
      border-radius: 6px;
      background: var(--background-color-default, #0d1117);
      white-space: pre;
    }
    .content .code-block code { padding: 0; background: transparent; }
    .content a { color: var(--true-color-blue, #58a6ff); }
    .remote-image-frame {
      margin: 8px 0 0;
      padding: 8px;
      border: 1px solid var(--border-color-default, #30363d);
      border-radius: 6px;
    }
    .remote-image { display: block; max-width: 100%; margin-top: 8px; }
    .message-toggle {
      border: 0;
      padding: 5px 0 0;
      background: transparent;
      color: var(--true-color-blue, #58a6ff);
      font-size: 12px;
      font-weight: var(--font-weight-semibold, 600);
    }
    .message-toggle:hover { text-decoration: underline; }
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
  <p id="status" role="status">Loading current session...</p>
  <aside id="notice" role="status" hidden></aside>
  <main id="content" aria-live="polite"></main>
  <button id="refresh" type="button" aria-label="Refresh" title="Refresh">
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M20 11a8 8 0 1 0-2.34 5.66" stroke-width="2" stroke-linecap="round"/>
      <path d="M20 4v7h-7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>
  <script>
    const content = document.querySelector("#content");
    const refreshButton = document.querySelector("#refresh");
    const status = document.querySelector("#status");
    const notice = document.querySelector("#notice");
    const token = new URLSearchParams(window.location.search).get("token") || "";
    const operationIdsByCheckpoint = new Map();
    const blockedCheckpoints = new Set();
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

    function checkpointKey(sessionId, turnId) {
      return sessionId + ":" + turnId;
    }

    function renderMessage(role, text, className, lineClamp) {
      const section = element("section", "message " + className);
      section.setAttribute("aria-label", role + " message");
      const rendered = renderMarkdown(text || "Waiting for Copilot's final response.");
      rendered.className = "content collapsed" + (text ? "" : " empty");
      rendered.style.setProperty("--line-clamp", String(lineClamp));
      section.append(rendered);

      const toggle = element("button", "message-toggle", "Expand");
      toggle.type = "button";
      toggle.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      toggle.addEventListener("click", (event) => {
        event.stopPropagation();
        const expanded = !rendered.classList.toggle("collapsed");
        toggle.textContent = expanded ? "Collapse" : "Expand";
        toggle.setAttribute("aria-expanded", String(expanded));
        requestAnimationFrame(() => {
          const family = document.querySelector(".family");
          if (family) drawConnections(family);
        });
      });
      section.append(toggle);
      requestAnimationFrame(() => {
        toggle.hidden = rendered.scrollHeight <= rendered.clientHeight + 1;
      });
      return section;
    }

    function renderMarkdown(markdown) {
      const container = element("div");
      const lines = String(markdown).replace(/\\r\\n?/g, "\\n").split("\\n");
      let index = 0;

      while (index < lines.length) {
        const line = lines[index];
        if (!line.trim()) {
          index += 1;
          continue;
        }

        const fence = /^ {0,3}\\x60\\x60\\x60([\\w+-]*)\\s*$/.exec(line);
        if (fence) {
          const codeLines = [];
          index += 1;
          while (
            index < lines.length &&
            !/^ {0,3}\\x60\\x60\\x60\\s*$/.test(lines[index])
          ) {
            codeLines.push(lines[index]);
            index += 1;
          }
          if (index < lines.length) index += 1;
          const pre = element("pre", "code-block");
          const code = element("code", "", codeLines.join("\\n"));
          if (fence[1]) code.dataset.language = fence[1];
          pre.append(code);
          container.append(pre);
          continue;
        }

        const heading = /^(#{1,6})\\s+(.+)$/.exec(line);
        if (heading) {
          const node = element("h" + heading[1].length, "markdown-heading");
          appendInline(node, heading[2]);
          container.append(node);
          index += 1;
          continue;
        }

        if (isTableStart(lines, index)) {
          const table = element("table", "markdown-table");
          const head = element("thead");
          const headRow = element("tr");
          tableCells(line).forEach((cell) => {
            const th = element("th");
            appendInline(th, cell);
            headRow.append(th);
          });
          head.append(headRow);
          table.append(head);
          index += 2;
          const body = element("tbody");
          while (index < lines.length && isTableRow(lines[index])) {
            const row = element("tr");
            tableCells(lines[index]).forEach((cell) => {
              const td = element("td");
              appendInline(td, cell);
              row.append(td);
            });
            body.append(row);
            index += 1;
          }
          table.append(body);
          container.append(table);
          continue;
        }

        const listMatch = /^(\\s*)([-*+]|\\d+\\.)\\s+(.+)$/.exec(line);
        if (listMatch) {
          const ordered = /\\d+\\./.test(listMatch[2]);
          const list = element(ordered ? "ol" : "ul", "markdown-list");
          while (index < lines.length) {
            const itemMatch = /^(\\s*)([-*+]|\\d+\\.)\\s+(.+)$/.exec(lines[index]);
            if (!itemMatch || /\\d+\\./.test(itemMatch[2]) !== ordered) break;
            const item = element("li");
            appendInline(item, itemMatch[3]);
            list.append(item);
            index += 1;
          }
          container.append(list);
          continue;
        }

        const paragraphLines = [line];
        index += 1;
        while (
          index < lines.length &&
          lines[index].trim() &&
          !isBlockStart(lines, index)
        ) {
          paragraphLines.push(lines[index]);
          index += 1;
        }
        const paragraph = element("p", "markdown-paragraph");
        appendInline(paragraph, paragraphLines.join("\\n"));
        container.append(paragraph);
      }
      return container;
    }

    function isBlockStart(lines, index) {
      return (
        /^ {0,3}\\x60\\x60\\x60/.test(lines[index]) ||
        /^(#{1,6})\\s+/.test(lines[index]) ||
        /^(\\s*)([-*+]|\\d+\\.)\\s+/.test(lines[index]) ||
        isTableStart(lines, index)
      );
    }

    function isTableStart(lines, index) {
      if (index + 1 >= lines.length || !isTableRow(lines[index])) return false;
      const separators = tableCells(lines[index + 1]);
      return separators.length > 0 &&
        separators.every((cell) => /^:?-{3,}:?$/.test(cell));
    }

    function isTableRow(line) {
      return line.includes("|") && tableCells(line).length > 1;
    }

    function tableCells(line) {
      const trimmed = line.trim().replace(/^\\|/, "").replace(/\\|$/, "");
      return trimmed.split("|").map((cell) => cell.trim());
    }

    function appendInline(parent, text) {
      const tokenPattern = /(\\x60[^\\x60\\n]+\\x60|\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__|!\\[[^\\]\\n]*\\]\\([^\\)\\n]+\\)|\\[[^\\]\\n]+\\]\\([^\\)\\n]+\\))/g;
      let offset = 0;
      for (const match of text.matchAll(tokenPattern)) {
        if (match.index > offset) parent.append(text.slice(offset, match.index));
        const token = match[0];
        if (token.startsWith("\\x60")) {
          parent.append(element("code", "inline-code", token.slice(1, -1)));
        } else if (token.startsWith("**") || token.startsWith("__")) {
          parent.append(
            element("strong", "markdown-strong", token.slice(2, -2)),
          );
        } else if (token.startsWith("!")) {
          appendRemoteImage(parent, token);
        } else {
          appendLink(parent, token);
        }
        offset = match.index + token.length;
      }
      if (offset < text.length) parent.append(text.slice(offset));
    }

    function appendLink(parent, token) {
      const match = /^\\[([^\\]]+)\\]\\(([^\\)]+)\\)$/.exec(token);
      const url = match && safeUrl(match[2]);
      if (!match || !url) {
        parent.append(match ? match[1] : token);
        return;
      }
      const link = element("a", "markdown-link", match[1]);
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.referrerPolicy = "no-referrer";
      parent.append(link);
    }

    function appendRemoteImage(parent, token) {
      const match = /^!\\[([^\\]]*)\\]\\(([^\\)]+)\\)$/.exec(token);
      const url = match && safeImageUrl(match[2]);
      if (!match || !url) {
        parent.append(match ? match[1] : token);
        return;
      }
      const frame = element("span", "remote-image-frame");
      const image = element("img", "remote-image");
      image.alt = match[1];
      image.referrerPolicy = "no-referrer";
      const load = element("button", "load-image", "Load remote image");
      load.type = "button";
      load.addEventListener("click", (event) => {
        event.stopPropagation();
        image.src = url;
        load.hidden = true;
      });
      frame.append(load, image);
      parent.append(frame);
    }

    function safeUrl(value) {
      try {
        const url = new URL(value.trim(), "http://127.0.0.1/");
        return ["http:", "https:"].includes(url.protocol) ? url.href : "";
      } catch {
        return "";
      }
    }

    function safeImageUrl(value) {
      const url = safeUrl(value);
      return url.startsWith("https://") ? url : "";
    }

    function showNotice(title, message, isError) {
      const closeButton = element("button", "notice-close", "Close");
      closeButton.type = "button";
      closeButton.setAttribute("aria-label", "Dismiss notification");
      closeButton.addEventListener("click", () => {
        notice.hidden = true;
      });
      notice.className = isError ? "error" : "";
      notice.replaceChildren(
        element("strong", "", title),
        element("span", "", message),
        closeButton,
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
      requestAnimationFrame(() => {
        article.querySelector(".branch-button")?.scrollIntoView({
          block: "nearest",
          inline: "nearest",
        });
      });
    }

    function updateBranchControls() {
      document.querySelectorAll(".branch-button").forEach((button) => {
        const isCurrentSession =
          button.dataset.sessionId === currentState?.session.id;
        button.disabled =
          !currentState ||
          (isCurrentSession && !currentState.canFork) ||
          forkPending ||
          blockedCheckpoints.has(button.dataset.checkpointKey);
      });
    }

    function renderForkAvailability() {
      status.hidden = !availabilityError && currentState?.canFork !== false;
      status.textContent = availabilityError ||
        (currentState?.canFork === false
          ? "Forking the current session is disabled while the agent is working."
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

    async function createBranch(sessionId, turn) {
      const key = checkpointKey(sessionId, turn.id);
      const isCurrentSession = sessionId === currentState?.session.id;
      if (
        forkPending ||
        blockedCheckpoints.has(key) ||
        !currentState ||
        (isCurrentSession && !currentState.canFork)
      ) return;
      forkPending = true;
      const operationId =
        operationIdsByCheckpoint.get(key) || crypto.randomUUID();
      operationIdsByCheckpoint.set(key, operationId);
      updateBranchControls();
      showNotice("Creating branch", "Creating a child session at this checkpoint...", false);

      try {
        const response = await fetch("/api/fork?token=" + encodeURIComponent(token), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operationId,
            sessionId,
            turnId: turn.id,
          }),
        });
        const result = await response.json();
        if (result.kind === "created") {
          blockedCheckpoints.add(key);
          showNotice("Branch created", "Opening " + result.name + "...", false);
          await refresh();
          requestAnimationFrame(() => {
            const childLane = Array.from(document.querySelectorAll(".lane")).find(
              (lane) => lane.dataset.sessionId === result.childSessionId,
            );
            childLane?.scrollIntoView({
              behavior: "smooth",
              block: "nearest",
              inline: "center",
            });
          });
          setTimeout(() => {
            blockedCheckpoints.delete(key);
            operationIdsByCheckpoint.delete(key);
            updateBranchControls();
          }, 10000);
        } else if (result.kind === "lineage_failed") {
          blockedCheckpoints.add(key);
          showNotice("Branch created without lineage", result.message, true);
        } else if (result.kind === "navigation_failed") {
          blockedCheckpoints.add(key);
          showNotice(
            "Branch ready",
            result.message ||
              ("Child session " + result.childSessionId + " is ready. Open it manually from the session list."),
            true,
          );
        } else {
          operationIdsByCheckpoint.delete(key);
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

    function drawConnections(family) {
      const svg = family.querySelector(".branch-connections");
      if (!svg) return;
      svg.replaceChildren();
      const entries = Array.from(document.querySelectorAll(".branch-entry"));
      document.querySelectorAll(".lane").forEach((lane) => {
        lane.style.paddingTop = "0px";
      });

      let familyRect = family.getBoundingClientRect();
      entries.forEach((entry) => {
        const source = findSourceTurn(entry);
        if (!source) return;
        const sourceRect = source.getBoundingClientRect();
        const lane = entry.parentElement;
        const branchTop =
          sourceRect.top +
          sourceRect.height / 2 -
          familyRect.top +
          family.scrollTop +
          48;
        lane.style.paddingTop = branchTop + "px";
      });

      familyRect = family.getBoundingClientRect();
      const width = Math.max(family.scrollWidth, familyRect.width);
      const height = Math.max(family.scrollHeight, familyRect.height);
      svg.setAttribute("viewBox", "0 0 " + width + " " + height);
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(height));
      svg.style.width = width + "px";
      svg.style.height = height + "px";

      const groups = new Map();
      entries.forEach((entry) => {
        const key =
          entry.dataset.parentSessionId + ":" + entry.dataset.sourceTurnId;
        const group = groups.get(key) || [];
        group.push(entry);
        groups.set(key, group);
      });

      groups.forEach((group) => {
        const source = findSourceTurn(group[0]);
        if (!source) return;

        const sourceRect = source.getBoundingClientRect();
        const startX = sourceRect.right - familyRect.left + family.scrollLeft;
        const busY =
          sourceRect.top + sourceRect.height / 2 - familyRect.top + family.scrollTop;
        const targets = group.map((entry) => {
          const rect = entry.getBoundingClientRect();
          return {
            entry,
            x: rect.left + rect.width / 2 - familyRect.left + family.scrollLeft,
            y: rect.top - familyRect.top + family.scrollTop,
          };
        });
        const busEndX = Math.max(
          ...targets.map(
            (target) => target.x - roundedStemRadius(busY, target.y),
          ),
        );
        const bus = svgLine(startX, busY, busEndX, busY);
        bus.setAttribute(
          "class",
          "branch-connection branch-bus" +
            (group.every((entry) => entry.classList.contains("pending"))
              ? " pending"
              : ""),
        );
        svg.append(bus);

        targets.forEach(({ entry, x, y }) => {
          const stem = svgRoundedStem(x, busY, y);
          stem.setAttribute(
            "class",
            "branch-connection branch-stem" +
              (entry.classList.contains("pending") ? " pending" : ""),
          );
          svg.append(stem);
        });
      });
    }

    function findSourceTurn(entry) {
      return Array.from(document.querySelectorAll(".turn")).find(
        (turn) =>
          turn.dataset.sessionId === entry.dataset.parentSessionId &&
          turn.dataset.turnId === entry.dataset.sourceTurnId,
      );
    }

    function svgLine(x1, y1, x2, y2) {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(x1));
      line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(x2));
      line.setAttribute("y2", String(y2));
      return line;
    }

    function svgRoundedStem(x, busY, targetY) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const radius = roundedStemRadius(busY, targetY);
      path.setAttribute(
        "d",
        "M " + (x - radius) + " " + busY +
          " Q " + x + " " + busY +
          " " + x + " " + (busY + radius) +
          " V " + targetY,
      );
      return path;
    }

    function roundedStemRadius(busY, targetY) {
      return Math.min(12, Math.max(0, (targetY - busY) / 2));
    }

    function renderLane(state, laneState) {
      const lane = element(
        "section",
        "lane" + (laneState.session.current ? " current" : ""),
      );
      lane.dataset.sessionId = laneState.session.id;

      if (laneState.sourceCheckpoint) {
        const isVirtual = laneState.turns.length === 0;
        const entry = element(
          isVirtual ? "article" : "div",
          isVirtual
            ? "turn virtual branch-entry pending"
            : "branch-entry",
        );
        entry.dataset.parentSessionId = laneState.sourceCheckpoint.sessionId;
        entry.dataset.sourceTurnId = laneState.sourceCheckpoint.turnId;
        if (isVirtual) {
          const actions = element("div", "lane-actions");
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
          const openButton = element("button", "open-chat", "Open Chat");
          openButton.type = "button";
          openButton.disabled = !laneState.session.available;
          openButton.addEventListener("click", () =>
            openChat(laneState.session.id),
          );
          actions.append(openButton);
          entry.append(
            element("p", "virtual-copy", "No conversation turns yet."),
            actions,
          );
        } else {
          entry.setAttribute("aria-hidden", "true");
        }
        lane.append(entry);
      }

      if (laneState.turns.length === 0 && !laneState.sourceCheckpoint) {
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
        const body = element("div", "turn-body");
        body.append(renderMessage("You", turn.userContent, "user", 3));
        body.append(renderMessage("Copilot", turn.assistantContent, "assistant", 8));
        article.append(body);
        if (completed && laneState.session.available) {
          const branchButton = element("button", "branch-button", "+ Fork");
          branchButton.type = "button";
          branchButton.dataset.sessionId = laneState.session.id;
          branchButton.dataset.turnId = turn.id;
          branchButton.dataset.checkpointKey = checkpointKey(
            laneState.session.id,
            turn.id,
          );
          branchButton.addEventListener("click", (event) => {
            event.stopPropagation();
            createBranch(laneState.session.id, turn);
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
      const connections = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      connections.setAttribute("class", "branch-connections");
      connections.setAttribute("aria-hidden", "true");
      family.append(connections);
      const lanes = state.lanes || [{
        session: { ...state.session, current: true, available: true },
        sourceCheckpoint: null,
        inheritedTurnCount: 0,
        turns: state.turns,
      }];
      lanes.forEach((lane) => family.append(renderLane(state, lane)));
      content.replaceChildren(family);
      requestAnimationFrame(() => drawConnections(family));
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
    window.addEventListener?.("resize", () => {
      const family = document.querySelector(".family");
      if (family) requestAnimationFrame(() => drawConnections(family));
    });
    setInterval(refreshForkAvailability, 2500);
    refresh();
  </script>
</body>
</html>`;
}
