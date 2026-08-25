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
      height: 100vh;
      overflow: hidden;
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
      display: grid;
      width: 32px;
      height: 32px;
      place-items: center;
      padding: 0;
      border-color: #58a6ff;
      background: #1f6feb;
      color: #fff;
    }
    #refresh:hover { background: #388bfd; }
    #refresh svg {
      width: 20px;
      height: 20px;
      stroke: #fff;
    }
    #refresh:disabled svg { animation: refresh-spin .8s linear infinite; }
    @keyframes refresh-spin { to { transform: rotate(360deg); } }
    main { height: 100%; }
    .map-viewport {
      width: 100%;
      height: 100%;
      overflow: auto;
      cursor: grab;
      overscroll-behavior: contain;
    }
    .map-viewport.panning {
      cursor: grabbing;
      user-select: none;
    }
    .map-stage {
      position: relative;
      min-width: 100%;
      min-height: 100%;
      padding: 24px 90px 82px 24px;
    }
    .map-controls {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 3;
      display: flex;
      gap: 6px;
      padding: 6px;
      border: 1px solid var(--border-color-default, #30363d);
      border-radius: 8px;
      background: var(--background-color-muted, #161b22);
      box-shadow: 0 4px 14px rgb(0 0 0 / 25%);
    }
    .map-controls button { padding: 5px 9px; }
    #zoom-level {
      min-width: 46px;
      align-self: center;
      color: var(--text-color-muted, #8b949e);
      text-align: center;
    }
    .minimap {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 3;
      width: 180px;
      padding: 8px;
      border: 1px solid var(--border-color-default, #30363d);
      border-radius: 8px;
      background: var(--background-color-muted, #161b22);
      box-shadow: 0 4px 14px rgb(0 0 0 / 25%);
    }
    .minimap-label {
      display: block;
      margin-bottom: 5px;
      color: var(--text-color-muted, #8b949e);
      font-size: 11px;
    }
    .minimap svg { display: block; width: 100%; height: 92px; }
    .minimap-lane {
      fill: var(--border-color-default, #30363d);
      stroke: var(--text-color-muted, #8b949e);
      stroke-width: 1;
    }
    .minimap-lane.current {
      fill: var(--true-color-blue, #1f6feb);
      stroke: var(--true-color-blue, #58a6ff);
    }
    .minimap-lane.collapsed {
      opacity: .35;
      stroke-dasharray: 2 2;
    }
    .minimap-selection { fill: var(--true-color-green, #3fb950); }
    .minimap-viewport {
      fill: color-mix(in srgb, var(--true-color-blue, #58a6ff) 12%, transparent);
      stroke: var(--true-color-blue, #58a6ff);
      stroke-width: 1.5;
      vector-effect: non-scaling-stroke;
    }
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
      padding: 2px 90px 2px 2px;
      transform-origin: 0 0;
    }
    .lane {
      position: relative;
      z-index: 1;
      width: min(340px, 100%);
      min-width: min(340px, calc(100vw - 48px));
    }
    .lane-tools {
      display: flex;
      justify-content: flex-end;
      min-height: 30px;
      margin-bottom: 8px;
    }
    .subtree-toggle {
      padding: 4px 8px;
      color: var(--text-color-muted, #8b949e);
      font-size: 11px;
    }
    .hide-subtree {
      padding: 4px 8px;
      color: var(--danger-color-emphasis, #f85149);
      font-size: 11px;
    }
    .lane-error {
      margin-bottom: 18px;
      border-color: var(--danger-color-emphasis, #f85149);
      color: var(--text-color-muted, #8b949e);
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
    .turn[data-rich="false"] {
      min-height: 120px;
      contain: layout style paint;
      contain-intrinsic-size: 120px;
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
  <nav class="map-controls" aria-label="Map controls">
    <button id="zoom-out" type="button" aria-label="Zoom out" title="Zoom out">−</button>
    <span id="zoom-level" aria-live="polite">100%</span>
    <button id="zoom-in" type="button" aria-label="Zoom in" title="Zoom in">+</button>
    <button id="fit-all" type="button">Fit all</button>
    <button id="focus-root" type="button">Focus root</button>
    <button id="show-hidden" type="button" hidden>Show hidden</button>
    <button id="refresh" type="button" aria-label="Refresh" title="Refresh">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M20 11a8 8 0 1 0-2.34 5.66" stroke-width="2" stroke-linecap="round"/>
        <path d="M20 4v7h-7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  </nav>
  <main id="content" aria-live="polite"></main>
  <script>
    const content = document.querySelector("#content");
    const refreshButton = document.querySelector("#refresh");
    const status = document.querySelector("#status");
    const notice = document.querySelector("#notice");
    const zoomOutButton = document.querySelector("#zoom-out");
    const zoomInButton = document.querySelector("#zoom-in");
    const zoomLevel = document.querySelector("#zoom-level");
    const fitAllButton = document.querySelector("#fit-all");
    const focusRootButton = document.querySelector("#focus-root");
    const showHiddenButton = document.querySelector("#show-hidden");
    const token = new URLSearchParams(window.location.search).get("token") || "";
    const operationIdsByCheckpoint = new Map();
    const blockedCheckpoints = new Set();
    const collapsedSessionIds = new Set();
    const expandedMessages = new Set();
    let laneElementsById = new Map();
    let laneFingerprintsById = new Map();
    const view = {
      scale: 1,
      minScale: 0.2,
      fitMinScale: 0.02,
      maxScale: 2,
    };
    const familyEndPadding = 90;
    const familyBottomPadding = 2;
    let currentState;
    let forkPending = false;
    let availabilityError = "";
    let focusedSessionId = "";
    let selectedCheckpoint;
    let turnObserver;
    let initializedFamilyId = "";
    let initializedCurrentSessionId = "";
    let refreshPromise;
    let refreshQueued = false;

    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function checkpointKey(sessionId, turnId) {
      return sessionId + ":" + turnId;
    }

    function currentMap() {
      const viewport = document.querySelector(".map-viewport");
      const stage = document.querySelector(".map-stage");
      const family = document.querySelector(".family");
      return viewport && stage && family ? { viewport, stage, family } : null;
    }

    function applyViewTransform() {
      const map = currentMap();
      if (!map) return;
      const { viewport, stage, family } = map;
      family.style.transform = "scale(" + view.scale + ")";
      const { width: unscaledWidth, height: unscaledHeight } =
        measureFamilyContent(family);
      stage.style.width =
        Math.max(viewport.clientWidth || 0, Math.ceil(unscaledWidth * view.scale) + 114) +
        "px";
      stage.style.height =
        Math.max(viewport.clientHeight || 0, Math.ceil(unscaledHeight * view.scale) + 106) +
        "px";
      zoomLevel.textContent = Math.round(view.scale * 100) + "%";
      updateMinimapViewport();
    }

    function measureFamilyContent(family) {
      const familyRect = family.getBoundingClientRect();
      const lanes = Array.from(family.querySelectorAll(".lane"));
      if (lanes.length === 0) {
        return {
          width: Math.max(1, familyRect.width / view.scale),
          height: Math.max(1, familyRect.height / view.scale),
        };
      }
      let right = 0;
      let bottom = 0;
      lanes.forEach((lane) => {
        const laneRect = lane.getBoundingClientRect();
        const left = Number.isFinite(lane.offsetLeft)
          ? lane.offsetLeft
          : (laneRect.left - familyRect.left) / view.scale;
        const top = Number.isFinite(lane.offsetTop)
          ? lane.offsetTop
          : (laneRect.top - familyRect.top) / view.scale;
        const width = lane.offsetWidth || laneRect.width / view.scale;
        const height = lane.offsetHeight || laneRect.height / view.scale;
        right = Math.max(right, left + width);
        bottom = Math.max(bottom, top + height);
      });
      return {
        width: Math.max(1, right + familyEndPadding),
        height: Math.max(1, bottom + familyBottomPadding),
      };
    }

    function setScale(nextScale, anchorX, anchorY) {
      const map = currentMap();
      if (!map) return;
      const { viewport } = map;
      const scale = Math.min(view.maxScale, Math.max(view.minScale, nextScale));
      if (scale === view.scale) return;
      const x = (viewport.scrollLeft + anchorX) / view.scale;
      const y = (viewport.scrollTop + anchorY) / view.scale;
      view.scale = scale;
      applyViewTransform();
      viewport.scrollLeft = x * scale - anchorX;
      viewport.scrollTop = y * scale - anchorY;
      drawConnections(map.family);
    }

    function zoomBy(factor) {
      const map = currentMap();
      if (!map) return;
      setScale(
        view.scale * factor,
        (map.viewport.clientWidth || 0) / 2,
        (map.viewport.clientHeight || 0) / 2,
      );
    }

    function fitAll() {
      const map = currentMap();
      if (!map) return;
      const { viewport, family } = map;
      const { width, height } = measureFamilyContent(family);
      const availableWidth = Math.max(1, (viewport.clientWidth || width) - 48);
      const availableHeight = Math.max(1, (viewport.clientHeight || height) - 48);
      view.scale = Math.min(
        1,
        Math.max(
          view.fitMinScale,
          Math.min(availableWidth / width, availableHeight / height),
        ),
      );
      applyViewTransform();
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
      drawConnections(family);
    }

    function focusRoot() {
      const rootSessionId = currentState?.family?.rootSessionId;
      if (!rootSessionId) return;
      laneElementsById.get(rootSessionId)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "center",
      });
    }

    function enableMapNavigation(viewport) {
      let drag;
      viewport.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        if (event.target.closest("button, a, .turn, .message")) return;
        drag = {
          x: event.clientX,
          y: event.clientY,
          left: viewport.scrollLeft,
          top: viewport.scrollTop,
        };
        viewport.classList.add("panning");
        viewport.setPointerCapture?.(event.pointerId);
        event.preventDefault();
      });
      viewport.addEventListener("pointermove", (event) => {
        if (!drag) return;
        viewport.scrollLeft = drag.left - (event.clientX - drag.x);
        viewport.scrollTop = drag.top - (event.clientY - drag.y);
      });
      const finishDrag = (event) => {
        if (!drag) return;
        drag = undefined;
        viewport.classList.remove("panning");
        viewport.releasePointerCapture?.(event.pointerId);
      };
      viewport.addEventListener("pointerup", finishDrag);
      viewport.addEventListener("pointercancel", finishDrag);
      viewport.addEventListener("scroll", () => updateMinimapViewport());
      viewport.addEventListener("wheel", (event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        const rect = viewport.getBoundingClientRect();
        event.preventDefault();
        setScale(
          view.scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1),
          event.clientX - rect.left,
          event.clientY - rect.top,
        );
      }, { passive: false });
    }

    function visibleLaneStates(state) {
      const lanes = state.lanes || [];
      const byId = new Map(lanes.map((lane) => [lane.session.id, lane]));
      const hiddenIds = new Set(state.family?.hiddenSessionIds || []);
      return lanes.filter((lane) => {
        let sessionId = lane.session.id;
        while (sessionId) {
          if (hiddenIds.has(sessionId)) return false;
          if (
            sessionId !== lane.session.id &&
            collapsedSessionIds.has(sessionId)
          ) return false;
          sessionId = byId.get(sessionId)?.parentSessionId || null;
        }
        return true;
      });
    }

    function initializeCollapsedSubtrees(state, lanes, childCountByParent) {
      const familyId = state.family?.id || state.family?.rootSessionId || "";
      const byId = new Map(lanes.map((lane) => [lane.session.id, lane]));
      const currentPath = new Set();
      let currentId = state.currentSessionId;
      while (currentId) {
        currentPath.add(currentId);
        currentId = byId.get(currentId)?.parentSessionId || null;
      }
      if (initializedFamilyId === familyId) {
        if (initializedCurrentSessionId !== state.currentSessionId) {
          currentPath.forEach((sessionId) => collapsedSessionIds.delete(sessionId));
          initializedCurrentSessionId = state.currentSessionId;
        }
        return;
      }
      collapsedSessionIds.clear();
      initializedFamilyId = familyId;
      initializedCurrentSessionId = state.currentSessionId;
      if (lanes.length <= 20) return;
      lanes.forEach((lane) => {
        if (
          childCountByParent.has(lane.session.id) &&
          !currentPath.has(lane.session.id)
        ) {
          collapsedSessionIds.add(lane.session.id);
        }
      });
    }

    function laneFingerprint(lane, hasChildren) {
      return JSON.stringify([
        lane.session,
        lane.parentSessionId,
        lane.inheritedTurnCount,
        lane.sourceCheckpoint,
        lane.turns,
        hasChildren,
        collapsedSessionIds.has(lane.session.id),
      ]);
    }

    function renderMinimap(
      viewport,
      lanes,
      visibleIds = new Set(lanes.map((lane) => lane.session.id)),
    ) {
      let minimap = document.querySelector(".minimap");
      if (!minimap) {
        minimap = element("aside", "minimap");
        minimap.setAttribute("aria-label", "Conversation family minimap");
        content.append(minimap);
      }
      const label = element("span", "minimap-label", "Minimap");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const width = Math.max(24, lanes.length * 14 + 10);
      const maxTurns = Math.max(1, ...lanes.map((lane) => lane.turns.length));
      const height = Math.max(48, maxTurns * 3 + 14);
      svg.setAttribute("viewBox", "0 0 " + width + " " + height);
      lanes.forEach((lane, index) => {
        const laneShape = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "rect",
        );
        laneShape.setAttribute(
          "class",
          "minimap-lane" +
            (lane.session.current ? " current" : "") +
            (visibleIds.has(lane.session.id) ? "" : " collapsed"),
        );
        laneShape.setAttribute("x", String(index * 14 + 5));
        laneShape.setAttribute("y", "5");
        laneShape.setAttribute("width", "8");
        laneShape.setAttribute(
          "height",
          String(Math.max(8, lane.turns.length * 3)),
        );
        svg.append(laneShape);
        if (selectedCheckpoint?.sessionId === lane.session.id) {
          const turnIndex = Math.max(
            0,
            lane.turns.findIndex((turn) => turn.id === selectedCheckpoint.turnId),
          );
          const marker = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "circle",
          );
          marker.setAttribute("class", "minimap-selection");
          marker.setAttribute("cx", String(index * 14 + 9));
          marker.setAttribute("cy", String(turnIndex * 3 + 7));
          marker.setAttribute("r", "2");
          svg.append(marker);
        }
      });
      const viewportShape = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "rect",
      );
      viewportShape.setAttribute("class", "minimap-viewport");
      viewportShape.dataset.mapWidth = String(width);
      viewportShape.dataset.mapHeight = String(height);
      svg.append(viewportShape);
      minimap.replaceChildren(label, svg);
      updateMinimapViewport(viewport, width, height);
    }

    function updateMinimapViewport(
      viewport = document.querySelector(".map-viewport"),
      minimapWidth,
      minimapHeight,
    ) {
      const shape = document.querySelector(".minimap-viewport");
      const stage = document.querySelector(".map-stage");
      if (!viewport || !stage || !shape) return;
      const width = minimapWidth || Number(shape.dataset.mapWidth) || 1;
      const height = minimapHeight || Number(shape.dataset.mapHeight) || 1;
      const stageWidth = Math.max(1, stage.scrollWidth || parseFloat(stage.style.width) || 1);
      const stageHeight = Math.max(1, stage.scrollHeight || parseFloat(stage.style.height) || 1);
      shape.setAttribute("x", String((viewport.scrollLeft / stageWidth) * width));
      shape.setAttribute("y", String((viewport.scrollTop / stageHeight) * height));
      shape.setAttribute(
        "width",
        String(Math.min(width, ((viewport.clientWidth || stageWidth) / stageWidth) * width)),
      );
      shape.setAttribute(
        "height",
        String(Math.min(height, ((viewport.clientHeight || stageHeight) / stageHeight) * height)),
      );
    }

    function renderMessage(role, text, className, lineClamp, messageKey) {
      const section = element("section", "message " + className);
      section.setAttribute("aria-label", role + " message");
      const rendered = renderMarkdown(text || "Waiting for Copilot's final response.");
      const initiallyExpanded = expandedMessages.has(messageKey);
      rendered.className =
        "content" +
        (initiallyExpanded ? "" : " collapsed") +
        (text ? "" : " empty");
      rendered.style.setProperty("--line-clamp", String(lineClamp));
      section.append(rendered);

      const toggle = element(
        "button",
        "message-toggle",
        initiallyExpanded ? "Collapse" : "Expand",
      );
      toggle.type = "button";
      toggle.hidden = !initiallyExpanded;
      toggle.setAttribute("aria-expanded", String(initiallyExpanded));
      toggle.addEventListener("click", (event) => {
        event.stopPropagation();
        const expanded = !rendered.classList.toggle("collapsed");
        if (expanded) expandedMessages.add(messageKey);
        else expandedMessages.delete(messageKey);
        toggle.textContent = expanded ? "Collapse" : "Expand";
        toggle.setAttribute("aria-expanded", String(expanded));
        requestAnimationFrame(() => {
          const family = document.querySelector(".family");
          if (family) drawConnections(family);
        });
      });
      section.append(toggle);
      requestAnimationFrame(() => {
        toggle.hidden =
          !expandedMessages.has(messageKey) &&
          rendered.scrollHeight <= rendered.clientHeight + 1;
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
      const previousSelection = document.querySelector(".turn.selected");
      previousSelection?.classList.remove("selected");
      if (
        previousSelection &&
        previousSelection !== article &&
        previousSelection.dataset.inViewport !== "true"
      ) {
        previousSelection.unmountRich?.();
      }
      document.querySelectorAll(".turn").forEach((turn) => {
        turn.setAttribute("aria-selected", "false");
      });
      article.classList.add("selected");
      article.setAttribute("aria-selected", "true");
      selectedCheckpoint = {
        sessionId: article.dataset.sessionId,
        turnId: article.dataset.turnId,
      };
      const map = currentMap();
      if (map && currentState) {
        const visibleIds = new Set(
          visibleLaneStates(currentState).map((lane) => lane.session.id),
        );
        renderMinimap(
          map.viewport,
          currentState.lanes || [],
          visibleIds,
        );
      }
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

    async function setSubtreeHidden(sessionId, hidden) {
      try {
        const response = await fetch(
          "/api/hidden-subtree?token=" + encodeURIComponent(token),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, hidden }),
          },
        );
        const result = await response.json();
        if (!response.ok || result.kind !== "updated") {
          throw new Error(result.message || "Hidden subtree update failed.");
        }
        await refresh();
      } catch (error) {
        showNotice(
          "Could not update hidden subtree",
          error instanceof Error ? error.message : "Unknown hidden subtree error.",
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
      const scale = view.scale;
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
          (sourceRect.top +
            sourceRect.height / 2 -
            familyRect.top) /
            scale +
          48;
        lane.style.paddingTop = branchTop + "px";
      });

      familyRect = family.getBoundingClientRect();
      const { width, height } = measureFamilyContent(family);
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
        const startX = (sourceRect.right - familyRect.left) / scale;
        const busY =
          (sourceRect.top + sourceRect.height / 2 - familyRect.top) / scale;
        const targets = group.map((entry) => {
          const rect = entry.getBoundingClientRect();
          return {
            entry,
            x: (rect.left + rect.width / 2 - familyRect.left) / scale,
            y: (rect.top - familyRect.top) / scale,
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

    function mountRichTurn(article, laneState, turn) {
      if (article.dataset.rich === "true") return;
      const body = element("div", "turn-body");
      const key = checkpointKey(laneState.session.id, turn.id);
      body.append(
        renderMessage("You", turn.userContent, "user", 3, key + ":user"),
      );
      body.append(
        renderMessage(
          "Copilot",
          turn.assistantContent,
          "assistant",
          8,
          key + ":assistant",
        ),
      );
      article.replaceChildren(body);
      if (
        turn.status === "completed" &&
        laneState.session.available &&
        !laneState.error &&
        (!laneState.session.inUse || laneState.session.current)
      ) {
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
      article.dataset.rich = "true";
      updateBranchControls();
    }

    function unmountRichTurn(article) {
      if (
        article.dataset.rich !== "true" ||
        article.classList.contains("selected")
      ) return;
      article.replaceChildren();
      article.dataset.rich = "false";
    }

    function setupTurnVirtualization(viewport, family) {
      turnObserver?.disconnect();
      const turns = Array.from(document.querySelectorAll(".turn")).filter(
        (turn) => !turn.classList.contains("virtual"),
      );
      if (typeof IntersectionObserver !== "function") {
        turns.forEach((turn) => {
          turn.dataset.inViewport = "true";
          turn.mountRich?.();
        });
        return;
      }
      turnObserver = new IntersectionObserver(
        (entries) => {
          let changed = false;
          entries.forEach((entry) => {
            const wasRich = entry.target.dataset.rich === "true";
            entry.target.dataset.inViewport = String(entry.isIntersecting);
            if (entry.isIntersecting) entry.target.mountRich?.();
            else entry.target.unmountRich?.();
            changed = changed || wasRich !== (entry.target.dataset.rich === "true");
          });
          if (changed) requestAnimationFrame(() => drawConnections(family));
        },
        { root: viewport, rootMargin: "600px 480px" },
      );
      turns.forEach((turn) => turnObserver.observe(turn));
    }

    function renderLane(state, laneState, hasChildren) {
      const lane = element(
        "section",
        "lane" + (laneState.session.current ? " current" : ""),
      );
      lane.dataset.sessionId = laneState.session.id;
      if (
        hasChildren ||
        (!laneState.session.available && !laneState.session.current)
      ) {
        const tools = element("div", "lane-tools");
        if (hasChildren) {
          const toggle = element(
            "button",
            "subtree-toggle",
            collapsedSessionIds.has(laneState.session.id)
              ? "Expand subtree"
              : "Collapse subtree",
          );
          toggle.type = "button";
          toggle.setAttribute(
            "aria-expanded",
            String(!collapsedSessionIds.has(laneState.session.id)),
          );
          toggle.addEventListener("click", (event) => {
            event.stopPropagation();
            if (collapsedSessionIds.has(laneState.session.id)) {
              collapsedSessionIds.delete(laneState.session.id);
            } else {
              collapsedSessionIds.add(laneState.session.id);
            }
            renderReady(currentState);
          });
          tools.append(toggle);
        }
        if (!laneState.session.available && !laneState.session.current) {
          const hide = element(
            "button",
            "hide-subtree",
            "Hide unavailable subtree",
          );
          hide.type = "button";
          hide.addEventListener("click", () =>
            setSubtreeHidden(laneState.session.id, true),
          );
          tools.append(hide);
        }
        lane.append(tools);
      }

      if (laneState.sourceCheckpoint) {
        const isVirtual =
          laneState.turns.length === 0 ||
          !laneState.sourceCheckpoint.available;
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
            laneState.sourceCheckpoint.available
              ? laneState.inheritedTurnCount +
                  " inherited " +
                  (laneState.inheritedTurnCount === 1 ? "turn" : "turns") +
                  " · Fork Checkpoint"
              : "Fork checkpoint unavailable",
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
            element(
              "p",
              "virtual-copy",
              !laneState.session.available
                ? "Session unavailable."
                : !laneState.sourceCheckpoint.available
                  ? "Fork checkpoint unavailable."
                : laneState.error || "No conversation turns yet.",
            ),
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
        article.dataset.rich = "false";
        article.setAttribute("aria-label", completed ? "Completed turn" : "Incomplete turn");
        const selected =
          selectedCheckpoint?.sessionId === laneState.session.id &&
          selectedCheckpoint?.turnId === turn.id;
        if (selected) article.classList.add("selected");
        article.setAttribute("aria-selected", String(selected));
        article.title = completed ? "Completed" : "Incomplete";
        article.mountRich = () => mountRichTurn(article, laneState, turn);
        article.unmountRich = () => unmountRichTurn(article);
        if (completed) {
          article.addEventListener("click", () => {
            article.mountRich();
            selectTurn(article);
          });
        }

        lane.append(article);
      });
      if (laneState.error && laneState.turns.length > 0) {
        lane.append(element("div", "state lane-error", laneState.error));
      }
      return lane;
    }

    function renderReady(state) {
      const previousViewport = document.querySelector(".map-viewport");
      const previousScroll = previousViewport
        ? { left: previousViewport.scrollLeft, top: previousViewport.scrollTop }
        : { left: 0, top: 0 };
      currentState = state;
      availabilityError = "";
      const hiddenSessionIds = state.family?.hiddenSessionIds || [];
      if (showHiddenButton) {
        showHiddenButton.hidden = hiddenSessionIds.length === 0;
        showHiddenButton.textContent =
          "Show hidden (" + hiddenSessionIds.length + ")";
      }
      const viewport = element("div", "map-viewport");
      const stage = element("div", "map-stage");
      const family = element("section", "family");
      const connections = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      connections.setAttribute("class", "branch-connections");
      connections.setAttribute("aria-hidden", "true");
      family.append(connections);
      const allLanes = state.lanes || [{
        session: { ...state.session, current: true, available: true },
        sourceCheckpoint: null,
        inheritedTurnCount: 0,
        turns: state.turns,
      }];
      const childCountByParent = new Map();
      allLanes.forEach((lane) => {
        if (!lane.parentSessionId) return;
        childCountByParent.set(
          lane.parentSessionId,
          (childCountByParent.get(lane.parentSessionId) || 0) + 1,
        );
      });
      initializeCollapsedSubtrees(state, allLanes, childCountByParent);
      const lanes = visibleLaneStates({ ...state, lanes: allLanes });
      const nextLaneElements = new Map();
      const nextLaneFingerprints = new Map();
      lanes.forEach((lane) => {
        const hasChildren = childCountByParent.has(lane.session.id);
        const fingerprint = laneFingerprint(lane, hasChildren);
        const cached =
          laneFingerprintsById.get(lane.session.id) === fingerprint
            ? laneElementsById.get(lane.session.id)
            : null;
        const laneElement = cached || renderLane(state, lane, hasChildren);
        nextLaneElements.set(lane.session.id, laneElement);
        nextLaneFingerprints.set(lane.session.id, fingerprint);
        family.append(laneElement);
      });
      laneElementsById = nextLaneElements;
      laneFingerprintsById = nextLaneFingerprints;
      stage.append(family);
      viewport.append(stage);
      content.replaceChildren(viewport);
      renderMinimap(
        viewport,
        allLanes,
        new Set(lanes.map((lane) => lane.session.id)),
      );
      enableMapNavigation(viewport);
      setupTurnVirtualization(viewport, family);
      requestAnimationFrame(() => {
        applyViewTransform();
        drawConnections(family);
        viewport.scrollLeft = previousScroll.left;
        viewport.scrollTop = previousScroll.top;
        updateMinimapViewport();
      });
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

    function refresh() {
      if (refreshPromise) {
        refreshQueued = true;
        return refreshPromise;
      }
      refreshPromise = (async () => {
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
      })().finally(() => {
        refreshPromise = undefined;
        if (refreshQueued) {
          refreshQueued = false;
          refresh();
        }
      });
      return refreshPromise;
    }

    refreshButton.addEventListener("click", refresh);
    zoomOutButton.addEventListener("click", () => zoomBy(1 / 1.2));
    zoomInButton.addEventListener("click", () => zoomBy(1.2));
    fitAllButton.addEventListener("click", fitAll);
    focusRootButton.addEventListener("click", focusRoot);
    showHiddenButton?.addEventListener("click", async () => {
      const hiddenSessionIds = currentState?.family?.hiddenSessionIds || [];
      await Promise.all(
        hiddenSessionIds.map((sessionId) => setSubtreeHidden(sessionId, false)),
      );
    });
    window.addEventListener?.("resize", applyViewTransform);
    window.addEventListener?.("resize", () => {
      const family = document.querySelector(".family");
      if (family) requestAnimationFrame(() => drawConnections(family));
    });
    setInterval(refreshForkAvailability, 2500);
    if (typeof EventSource === "function") {
      const events = new EventSource(
        "/api/events?token=" + encodeURIComponent(token),
      );
      events.addEventListener("invalidate", refresh);
    }
    refresh();
  </script>
</body>
</html>`;
}
