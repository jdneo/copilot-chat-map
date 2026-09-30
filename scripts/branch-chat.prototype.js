// Appended to the existing renderer script. All execution and fork actions below are mocks.
const variants = { A: "Input inside latest node", B: "Fixed bottom composer", C: "Map + reading pane" };
let variant = new URLSearchParams(location.search).get("variant") || "A";
if (!variants[variant]) variant = "A";
let selectedBranch = "empty";
let execution = null;
let lastOutcome = null;
let sequence = 0;
const drafts = { empty: "", history: "", root: "" };
const draftVersions = { empty: 0, history: 0, root: 0 };
const historyPositions = {};
const blocks = {};
const releaseBlockReason = "Map connection release failed. Do not take over in CLI; recheck ownership first.";
const timers = new Set();
const titles = { root: "Root / App session", empty: "Explore an alternative", history: "Existing CLI-only branch" };
const demo = {
  kind: "ready", currentSessionId: "root", canFork: true,
  session: { id: "root", available: true, current: true, inUse: true },
  family: { id: "prototype", rootSessionId: "root", hiddenSessionIds: [] },
  lanes: [
    {
      session: { id: "root", available: true, current: true, inUse: true },
      turns: [
        { id: "root-1", userContent: "Plan a conversation map with branching history.", assistantContent: "Use one lane per session and one node per user turn. Keep the shared history in the parent lane.", status: "completed" },
        { id: "root-2", userContent: "Keep the first version focused.", assistantContent: "Start with input, send, and the final response. Keep the branch structure visible while reading.", status: "completed" },
      ],
    },
    {
      session: { id: "empty", available: true, current: false, inUse: false },
      parentSessionId: "root", inheritedTurnCount: 1,
      sourceCheckpoint: { sessionId: "root", turnId: "root-1", available: true },
      turns: [],
    },
    {
      session: { id: "history", available: true, current: false, inUse: false },
      parentSessionId: "root", inheritedTurnCount: 2,
      sourceCheckpoint: { sessionId: "root", turnId: "root-2", available: true },
      turns: [
        { id: "history-1", userContent: "Compare inline input with a fixed composer.", assistantContent: "Inline input makes the destination obvious, but it scales with the map. A fixed composer keeps typing comfortable at any zoom.", status: "completed" },
        { id: "history-2", userContent: "What happens when I read an older turn?", assistantContent: "Reading an older turn does not rewind this branch. Continue always appends after its latest turn. Fork creates a new branch instead.", status: "completed" },
      ],
    },
  ],
};
const inputHistory = demo.lanes.flatMap(lane => lane.turns.map(turn => turn.userContent));
const longResponse = [
  "## Recommendation", "Keep input attached to the branch, not to the selected checkpoint.",
  "### Why this matters", "A historical turn is a reading or fork target. It is not an insertion point for new messages.",
  "### Interaction rules",
  ...Array.from({ length: 8 }, (_, index) => (index + 1) + ". Preserve the user's reading position while the response arrives. New content belongs to its original branch, even after selection changes."),
  "```js\nconst target = branch.id;\nawait sendToBranch(target, draft);\n```",
  "### Next step", "Compare these layouts at 60% and 100% zoom, then send a second message without switching to the CLI.",
].join("\n\n");

function button(text, handler, className = "") {
  const result = element("button", className, text);
  result.type = "button";
  result.onclick = event => { event.stopPropagation(); handler(event); };
  return result;
}
function later(callback, delay) {
  const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
  timers.add(timer);
}
function laneFor(id) { return demo.lanes.find(lane => lane.session.id === id); }
function reason(id) {
  if (id === "root") return "Root is owned by the App. Fork a completed turn to chat in Map.";
  if (execution) return titles[execution.branch] + ": " + execution.state + ". You can edit drafts; sending is blocked across this family.";
  return blocks[id] || "";
}
function choose(id, focus = false) {
  selectedBranch = id;
  renderPrototype();
  if (focus) document.querySelector('[data-composer="' + id + '"] textarea')?.focus({ preventScroll: true });
}
function gotoLatest(id) {
  choose(id);
  followBranchEnd(id);
}
function followBranchEnd(id) {
  requestAnimationFrame(() => {
    const lane = document.querySelector('.lane[data-session-id="' + id + '"]');
    (lane?.querySelector(".prototype-composer") || lane?.lastElementChild)?.scrollIntoView({ block: "end", inline: "center" });
  });
}
function atBranchEnd(id) {
  if (selectedBranch !== id) return false;
  if (variant !== "A") return true;
  const lane = document.querySelector('.lane[data-session-id="' + id + '"]');
  const end = lane?.lastElementChild?.getBoundingClientRect();
  const viewport = document.querySelector(".map-viewport")?.getBoundingClientRect();
  return end && viewport && end.bottom <= viewport.bottom + 48 &&
    end.bottom >= viewport.top && end.left < viewport.right && end.right > viewport.left;
}
const toolbar = element("aside", "prototype-toolbar");
toolbar.append(element("strong", "", "THROWAWAY / MOCK ONLY"));
const targetSelect = element("select");
targetSelect.setAttribute("aria-label", "Selected branch");
targetSelect.onchange = () => choose(targetSelect.value);
const scenarioSelect = element("select");
scenarioSelect.setAttribute("aria-label", "Simulated outcome");
[
  ["complete", "Final response"], ["long", "Long final response"], ["wait", "Needs approval / question"],
  ["fail", "Fails after acceptance"], ["reject", "Submission rejected"],
  ["unknown", "Unknown before acceptance"], ["interrupt", "Interrupted / no final reply"],
  ["release", "Complete / release fails"], ["hold", "Run until stopped"],
].forEach(([value, label]) => {
  const option = element("option", "", label); option.value = value; scenarioSelect.append(option);
});
const initialScenario = new URLSearchParams(location.search).get("scenario");
if ([...scenarioSelect.options].some(option => option.value === initialScenario)) {
  scenarioSelect.value = initialScenario;
}
const blockSelect = element("select");
blockSelect.setAttribute("aria-label", "Simulated branch availability");
[
  ["", "Branch available"], ["External CLI owns this session. Map is read-only.", "External CLI occupancy"],
  ["Working directory is unavailable. Fix it in CLI; no fallback directory.", "Directory unavailable"],
  ["Saved model cannot be restored. Fix it in CLI; no model fallback.", "Model unavailable"],
].forEach(([value, label]) => {
  const option = element("option", "", label); option.value = value; blockSelect.append(option);
});
blockSelect.onchange = () => { blocks[selectedBranch] = blockSelect.value; renderPrototype(); };
toolbar.append(targetSelect, scenarioSelect, blockSelect);
toolbar.append(button("Reset demo", () => location.reload()));
const confirmNotAccepted = button("Mock: confirm not accepted", () => {
  if (execution?.state === "Checking / result unknown") {
    finishRun(execution, "Not accepted", "No message was recorded. Draft retained.", false);
  }
});
confirmNotAccepted.hidden = true;
toolbar.append(confirmNotAccepted);
toolbar.append(element("span", "prototype-hint", "No real sessions or files are changed. Drafts reset on reload."));
document.body.prepend(toolbar);
const dock = element("aside", "prototype-dock");
const side = element("aside", "prototype-side");
const stateDetails = element("details", "prototype-state");
stateDetails.append(element("summary", "", "Inspect mock state"), element("pre"));
const switcher = element("nav", "prototype-switcher");
switcher.setAttribute("aria-label", "Prototype variants");
const switchLabel = element("span");
switcher.append(button("<", () => changeVariant(-1)), switchLabel, button(">", () => changeVariant(1)));
document.body.append(dock, side, stateDetails, switcher);

function inspectState() {
  stateDetails.querySelector("pre").textContent = JSON.stringify({
    variant, selectedBranch, drafts, draftVersions, inputHistory, historyPositions, execution, lastOutcome, blocks,
    turns: demo.lanes.map(lane => ({ branch: lane.session.id, turns: lane.turns.map(turn => ({ id: turn.id, status: turn.status })) })),
  }, null, 2);
}
function changeVariant(step) {
  variant = Object.keys(variants)[(Object.keys(variants).indexOf(variant) + step + 3) % 3];
  const url = new URL(location.href); url.searchParams.set("variant", variant); history.replaceState(null, "", url);
  renderPrototype();
}
function onBoundaryLine(input, direction) {
  if (input.selectionStart !== input.selectionEnd) return false;
  const style = getComputedStyle(input);
  const mirror = element("div");
  mirror.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;white-space:pre-wrap;overflow-wrap:break-word;box-sizing:border-box";
  for (const property of ["font", "letterSpacing", "wordSpacing", "tabSize", "padding", "textIndent", "lineHeight"]) {
    mirror.style[property] = style[property];
  }
  mirror.style.width = input.clientWidth + "px";
  const first = element("span", "", "\u200b");
  const caret = element("span", "", "\u200b");
  const last = element("span", "", "\u200b");
  mirror.append(first, document.createTextNode(input.value.slice(0, input.selectionStart)),
    caret, document.createTextNode(input.value.slice(input.selectionStart)), last);
  document.body.append(mirror);
  const boundary = direction < 0 ? first : last;
  const result = Math.abs(caret.offsetTop - boundary.offsetTop) < 1;
  mirror.remove();
  return result;
}
function recallInput(id, input, direction) {
  if (!onBoundaryLine(input, direction)) return false;
  let position = historyPositions[id];
  if (!position) {
    if (direction > 0 || inputHistory.length === 0) return false;
    position = { entries: [...inputHistory, input.value], index: inputHistory.length };
    historyPositions[id] = position;
  }
  position.entries[position.index] = input.value;
  position.index = Math.max(0, Math.min(position.entries.length - 1, position.index + direction));
  input.value = position.entries[position.index];
  if (position.index === position.entries.length - 1) delete historyPositions[id];
  drafts[id] = input.value; draftVersions[id]++;
  const caret = direction < 0 ? 0 : input.value.length;
  input.setSelectionRange(caret, caret);
  return true;
}
function runNotice(run) {
  const releaseFailed = run.state === "Completed" && run.scenario === "release";
  const box = element("div", "prototype-status prototype-run");
  box.setAttribute("role", "status");
  if (execution === run) {
    if (["Submitting", "Running", "Stopping"].includes(run.state)) {
      if (run.state !== "Stopping" || run.branch !== selectedBranch) {
        const spinner = element("span", "prototype-spinner");
        spinner.setAttribute("aria-hidden", "true");
        box.append(spinner);
      }
      box.setAttribute("aria-label", run.state);
      if (run.state !== "Running" && run.branch !== selectedBranch) {
        box.append(element("span", "", run.state === "Submitting" ? "Sending..." : "Stopping..."));
      }
    } else {
      box.classList.add("warning");
      box.append(element("span", "", run.state === "Checking / result unknown"
        ? "Status unknown."
        : "Needs input - not supported in Map."));
    }
    const elapsed = element("span", "prototype-elapsed", Math.floor((Date.now() - run.started) / 1000) + "s");
    elapsed.dataset.started = String(run.started); box.append(elapsed);
    if (run.state === "Checking / result unknown") {
      box.append(button("Check status", () => {
        run.message = "Still cannot confirm acceptance or execution. Sending stays blocked. No automatic resend.";
        renderPrototype();
      }));
      const details = element("details", "prototype-details");
      details.append(element("summary", "", "Details"));
      details.append(element("p", "", run.message));
      details.append(element("p", "", "Submitted message (acceptance unconfirmed):"), element("pre", "", run.prompt));
      box.append(details);
    }
  } else if (run.state === "Stopped") {
    box.append(element("span", "", "Stopped"));
    if (run.needsCli && !blocks[run.branch]) {
      const handoff = element("div", "prototype-handoff");
      handoff.append(element("p", "", "Continue in CLI to handle the interaction. You may need to trigger it again."));
      handoff.append(element("code", "", "copilot --resume=<" + run.branch + "-session-id>"));
      box.append(handoff);
    }
  } else {
    box.classList.add("error");
    const summary = releaseFailed ? "Could not release session." : ({
      Failed: "Failed: tool execution failed.",
      Interrupted: "Interrupted: no final response.",
      "Not accepted": run.scenario === "reject" ? "Not sent: session is in use." : "Message was not accepted.",
    })[run.state];
    box.append(element("span", "", summary || run.state));
    if (run.message) {
      const details = element("details", "prototype-details");
      details.append(element("summary", "", "Details"), element("p", "", run.message));
      box.append(details);
    }
  }
  return box;
}
function busyNotice(run) {
  const labels = {
    Submitting: "sending",
    Running: "working",
    Stopping: "stopping",
    "Waiting for unsupported interaction": "needs input",
    "Checking / result unknown": "status unknown",
  };
  const box = element("div", "prototype-status");
  box.append(element("span", "", titles[run.branch] + ": " + labels[run.state] + "."));
  box.append(button("Go to branch", () => gotoLatest(run.branch)));
  return box;
}
function retryWarning(id) {
  const position = historyPositions[id];
  if (!position) return false;
  const recalled = inputHistory[position.index];
  return demo.lanes.some(lane => lane.turns.some(turn =>
    turn.userContent === recalled && ["Failed", "Stopped", "Interrupted"].includes(turn.mockOutcome?.state)));
}
function composer(id) {
  const box = element("section", "prototype-composer" + (id === selectedBranch ? " active" : ""));
  box.dataset.composer = id;
  box.append(element("h3", "", "Continue: " + titles[id]));
  if (selectedCheckpoint?.sessionId === id && laneFor(id).turns.at(-1)?.id !== selectedCheckpoint.turnId) {
    box.append(element("div", "prototype-meta", "Reading an older turn. Send continues after the latest turn; use + on the older node to fork there."));
  }
  const input = element("textarea");
  input.setAttribute("aria-label", "Draft for " + titles[id]);
  input.placeholder = "Message this branch..."; input.value = drafts[id] || "";
  const ownExecution = execution?.branch === id ? execution : null;
  const canStop = ownExecution && ["Running", "Waiting for unsupported interaction"].includes(ownExecution.state);
  const stopping = ownExecution?.state === "Stopping";
  const submitting = ownExecution?.state === "Submitting";
  const send = button(
    canStop || stopping ? "Stop" : "Send",
    () => canStop ? stopRun(ownExecution) : submit(id),
    "prototype-send" + (canStop || stopping ? " prototype-stop" : ""),
  );
  if (submitting || stopping) {
    const spinner = element("span", "prototype-spinner");
    spinner.setAttribute("aria-hidden", "true");
    send.prepend(spinner);
    send.setAttribute("aria-label", submitting ? "Sending" : "Stopping");
    send.setAttribute("aria-busy", "true");
  }
  const risk = element("div", "prototype-status warning", "Sending again may repeat tool or file changes.");
  function updateDraftControls() {
    send.disabled = canStop ? false : Boolean(reason(id)) || !input.value.trim();
    risk.hidden = !retryWarning(id);
    inspectState();
  }
  updateDraftControls();
  input.oninput = () => {
    drafts[id] = input.value; draftVersions[id]++;
    if (historyPositions[id]) historyPositions[id].entries[historyPositions[id].index] = input.value;
    updateDraftControls();
  };
  input.onfocus = () => {
    selectedBranch = id; targetSelect.value = id;
    document.querySelectorAll("[data-composer]").forEach(node => node.classList.toggle("active", node.dataset.composer === id));
    if (variant === "A" && view.scale !== 1) {
      setScale(1, 0, 0); followBranchEnd(id);
    }
    inspectState();
  };
  input.onkeydown = event => {
    if (["ArrowUp", "ArrowDown"].includes(event.key) &&
        !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey &&
        !event.isComposing && event.keyCode !== 229 &&
        recallInput(id, input, event.key === "ArrowUp" ? -1 : 1)) {
      event.preventDefault();
      updateDraftControls();
    }
    if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey &&
        !event.isComposing && event.keyCode !== 229) {
      event.preventDefault(); submit(id);
    }
    event.stopPropagation();
  };
  box.addEventListener("pointerdown", event => event.stopPropagation());
  box.addEventListener("click", event => event.stopPropagation());
  box.addEventListener("wheel", event => event.stopPropagation(), { passive: true });
  box.append(input, risk);
  if (execution && execution.branch !== id) box.append(busyNotice(execution));
  if (!execution && blocks[id] && blocks[id] !== releaseBlockReason) {
    const summary = blocks[id].split(". ")[0] + ".";
    box.append(element("div", "prototype-status warning", summary));
  }
  if (id === "root") {
    box.append(element("div", "prototype-status", "This session is owned by the App."));
  }
  if (ownExecution && !ownExecution.turnId && !submitting) box.append(runNotice(ownExecution));
  if (lastOutcome?.branch === id && !lastOutcome.turnId) box.append(runNotice(lastOutcome));
  const footer = element("footer");
  footer.append(send);
  box.append(footer);
  return box;
}
function submit(id) {
  if (reason(id) || !drafts[id]?.trim()) return;
  const run = {
    branch: id, prompt: drafts[id], draftVersion: draftVersions[id], scenario: scenarioSelect.value, started: Date.now(),
    returnDraft: historyPositions[id]?.entries.at(-1) || "",
    state: "Submitting", message: "Checking acceptance. This is not a Turn Node yet.",
  };
  inputHistory.push(run.prompt);
  execution = run; lastOutcome = null; selectedBranch = id; renderPrototype();
  followBranchEnd(id);
  document.querySelector('[data-composer="' + id + '"] textarea')?.focus({ preventScroll: true });
  later(() => {
    if (execution !== run) return;
    if (run.scenario === "reject") {
      finishRun(run, "Not accepted", "Submission rejected: session ownership changed. Draft retained.", false);
      return;
    }
    if (run.scenario === "unknown") {
      run.state = "Checking / result unknown";
      run.message = "Connection lost before acceptance was confirmed. Submitted text is retained separately from your draft.";
      renderPrototype(); return;
    }
    const follow = atBranchEnd(id);
    run.turnId = "mock-" + (++sequence);
    laneFor(id).turns.push({ id: run.turnId, userContent: run.prompt, assistantContent: "", status: "incomplete" });
    if (draftVersions[id] === run.draftVersion) {
      drafts[id] = run.returnDraft; draftVersions[id]++;
      delete historyPositions[id];
    }
    run.state = "Running"; run.message = "Accepted into this branch's history. Waiting for the final response.";
    renderPrototype();
    if (follow) followBranchEnd(id);
    later(() => {
      if (execution !== run || run.state !== "Running") return;
      if (run.scenario === "wait") {
        run.state = "Waiting for unsupported interaction";
        run.needsCli = true;
        run.message = "This run needs approval or an answer. Map cannot handle it. Stop, wait for release, then continue in CLI.";
        renderPrototype(); return;
      }
      if (run.scenario === "hold") return;
      if (run.scenario === "fail") return finishRun(run, "Failed", "Tool execution failed. No final response.");
      if (run.scenario === "interrupt") return finishRun(run, "Interrupted", "Execution ended without a final response.");
      finishRun(run, "Completed", run.scenario === "release" ? "Final response confirmed, but connection release failed. CLI handoff unavailable." : "Final response confirmed. Connection released.");
    }, 7000);
  }, 1700);
}
function stopRun(run) {
  if (execution !== run) return;
  run.state = "Stopping";
  run.message = "Waiting for confirmed termination. Existing file or tool effects are not undone.";
  renderPrototype();
  later(() => {
    if (execution === run) finishRun(run, "Stopped", "Termination confirmed. Connection released; previous effects remain.");
  }, 2000);
}
function finishRun(run, state, message, hasTurn = true) {
  const follow = atBranchEnd(run.branch);
  const turn = hasTurn && laneFor(run.branch).turns.find(turn => turn.id === run.turnId);
  if (turn) {
    turn.status = state === "Completed" ? "completed" : "incomplete";
    turn.assistantContent = state === "Completed"
      ? (run.scenario === "long" ? longResponse : "This is the final response for **" + titles[run.branch] + "**.\n\nYour message was appended as a new turn. The original Fork Checkpoint has not changed.\n\nYou can now send a follow-up in this same branch.")
      : "";
    turn.mockOutcome = { ...run, state, message };
  }
  if (run.scenario === "release" && state === "Completed") blocks[run.branch] = releaseBlockReason;
  run.state = state; run.message = message;
  lastOutcome = run; execution = null; renderPrototype();
  if (follow) followBranchEnd(run.branch);
}

const baseUpdateLane = updateLane;
updateLane = function(lane, laneState, hasChildren, nextTurns) {
  lane.branchEntryFingerprint = "";
  baseUpdateLane(lane, laneState, hasChildren, nextTurns);
  const id = laneState.session.id;
  const target = button(titles[id] + (id === selectedBranch ? " / selected" : " / continue"), () => choose(id, true), "prototype-target" + (id === selectedBranch ? " active" : ""));
  if (variant !== "A") lane.prepend(target);
};
renderVirtualCopy = function(laneState) {
  const box = element("div", "prototype-entry");
  box.append(element("strong", "", "New branch / no new turns"));
  box.append(element("p", "", "Continue from the inherited history. Your first accepted message becomes the first new node."));
  if (variant !== "A") box.append(button("Write first message", () => choose(laneState.session.id, true)));
  return box;
};
const baseUpdateRichTurn = updateRichTurn;
updateRichTurn = function(article, laneState, turn) {
  baseUpdateRichTurn(article, laneState, turn);
  const run = execution?.turnId === turn.id ? execution : turn.mockOutcome;
  if (run) {
    if (run.state !== "Completed") {
      const response = article.querySelector(".message.assistant");
      response.replaceChildren(runNotice(run));
      delete response.renderedText;
    } else if (run.scenario === "release") article.append(runNotice(run));
  }
  const fork = article.querySelector(".branch-button");
  if (fork) {
    fork.setAttribute("aria-label", "Fork here (mock)");
    fork.title = "Fork from this completed turn (mock only)";
    fork.disabled = Boolean(execution);
  }
};
createBranch = async function(parentId, turn) {
  if (execution || turn.status !== "completed") return;
  const id = "fork-" + (++sequence);
  titles[id] = "New branch " + sequence; drafts[id] = ""; draftVersions[id] = 0;
  demo.lanes.push({
    session: { id, available: true, current: false, inUse: false },
    parentSessionId: parentId,
    inheritedTurnCount: laneFor(parentId).turns.indexOf(turn) + 1,
    sourceCheckpoint: { sessionId: parentId, turnId: turn.id, available: true }, turns: [],
  });
  gotoLatest(id);
  document.querySelector('[data-composer="' + id + '"] textarea')?.focus({ preventScroll: true });
};
setupTurnVirtualization = function() {
  document.querySelectorAll(".turn:not(.virtual)").forEach(article => {
    article.dataset.inViewport = "true"; article.mountRich?.();
  });
};
function renderPrototype() {
  const active = document.activeElement;
  const focusBranch = active?.closest("[data-composer]")?.dataset.composer;
  const caret = active?.tagName === "TEXTAREA" ? [active.selectionStart, active.selectionEnd] : null;
  const oldViewport = document.querySelector(".map-viewport");
  const position = oldViewport && [oldViewport.scrollLeft, oldViewport.scrollTop];
  document.body.dataset.variant = variant;
  confirmNotAccepted.hidden = execution?.state !== "Checking / result unknown";
  switchLabel.textContent = variant + " / " + variants[variant];
  targetSelect.replaceChildren();
  Object.entries(titles).forEach(([id, title]) => {
    const option = element("option", "", title); option.value = id; targetSelect.append(option);
  });
  targetSelect.value = selectedBranch;
  blockSelect.value = blocks[selectedBranch] || "";
  demo.canFork = !execution;
  renderedStateFingerprint = "";
  turnElementsByKey.forEach(article => { article.richFingerprint = ""; });
  renderReady(demo);
  if (variant === "A") {
    demo.lanes.forEach(lane => {
      const id = lane.session.id;
      if (id === "root") return;
      const node = lane.turns.length
        ? turnElementsByKey.get(checkpointKey(id, lane.turns.at(-1).id))
        : laneElementsById.get(id)?.querySelector(".branch-entry");
      if (!node) return;
      if (id === selectedBranch) {
        node.append(composer(id));
      } else {
        if (execution?.branch === id && !execution.turnId) node.append(runNotice(execution));
        node.append(button("Continue: " + titles[id], () => choose(id, true), "prototype-target prototype-tail-entry"));
      }
    });
  }
  dock.replaceChildren(); side.replaceChildren();
  dock.hidden = variant !== "B";
  if (variant === "B") dock.append(composer(selectedBranch));
  if (variant === "C") {
    side.append(element("strong", "", titles[selectedBranch]));
    const reader = element("div", "prototype-reader");
    reader.append(element("div", "prototype-meta", "Inherited history remains on the map. New turns are shown below."));
    laneFor(selectedBranch).turns.forEach(turn => {
      reader.append(renderMessage("You", turn.userContent, "user", 3, "reader:" + turn.id + ":user"));
      reader.append(renderMessage("Copilot", turn.assistantContent, "assistant", 8, "reader:" + turn.id + ":assistant"));
    });
    side.append(reader, composer(selectedBranch));
  }
  if (position) { oldViewport.scrollLeft = position[0]; oldViewport.scrollTop = position[1]; }
  if (focusBranch && caret) {
    const input = document.querySelector('[data-composer="' + focusBranch + '"] textarea');
    input?.focus({ preventScroll: true }); input?.setSelectionRange(...caret);
  }
  inspectState();
}
document.addEventListener("keydown", event => {
  if (event.target.closest("input, textarea, select, [contenteditable]")) return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault(); changeVariant(event.key === "ArrowLeft" ? -1 : 1);
  }
});
document.addEventListener("click", event => {
  const article = event.target.closest(".turn[data-session-id]");
  if (article && !event.target.closest("button, a, textarea")) choose(article.dataset.sessionId);
});
refreshButton.onclick = renderPrototype;
zoomOutButton.onclick = () => zoomBy(1 / 1.2);
zoomInButton.onclick = () => zoomBy(1.2);
fitAllButton.onclick = fitAll;
focusRootButton.onclick = focusRoot;
window.addEventListener("resize", applyViewTransform);
window.addEventListener("resize", () => drawConnections(document.querySelector(".family")));
setInterval(() => {
  document.querySelectorAll(".prototype-elapsed").forEach(node => {
    node.textContent = Math.floor((Date.now() - Number(node.dataset.started)) / 1000) + "s";
  });
}, 1000);
focusedSessionId = "root";
renderPrototype();
followBranchEnd(selectedBranch);
if (new URLSearchParams(location.search).get("demo") === "running") {
  drafts.empty = "Demonstrate the shared status while I edit another branch.";
  draftVersions.empty++;
  scenarioSelect.value = "hold";
  submit("empty");
  later(() => choose("history"), 2000);
}
if (new URLSearchParams(location.search).get("demo") === "reply") {
  laneFor("empty").turns.push({
    id: "reply-example", userContent: "Explain this option in detail.",
    assistantContent: longResponse, status: "completed",
  });
  selectedBranch = "history";
  renderPrototype();
}
new ResizeObserver(() => {
  const contentTop = toolbar.offsetHeight + 6;
  content.style.top = contentTop + "px";
  document.querySelector(".map-controls").style.top = (contentTop + 8) + "px";
  side.style.top = contentTop + "px";
}).observe(toolbar);
