# Branch chat: Windows submission and recovery evidence

Date: 2026-10-01.

Task: [验证分支聊天的提交归属与中断恢复能力](https://github.com/jdneo/copilot-chat-map/issues/17).
Behavior contract: [确定分支聊天的运行与恢复规则](https://github.com/jdneo/copilot-chat-map/issues/13#issuecomment-5905653801).

## Scope and disposition

**Protocol evidence, not a production chat implementation or release approval.**
The retained corpus has 48 scenario executions: two independent runs of 24
scenarios on Windows x64, actual runtime `1.0.90-0`, protocol 3. Both runs have
zero harness errors, zero real model calls, and verified deletion of all 26
synthetic sessions per run. Each generated temporary home was removed.

The maintainer explicitly selected:

- Verify the currently installed Windows runtime first; retain the minimum
  version and other platforms as unverified. The previously tested `1.0.87-0`
  and `1.0.88` installations were no longer present. This does not change the
  map's minimum-version or cross-platform release promises into passing results.
- Authorize only reads of this experiment's generated `sentinel.txt`, with an
  exact-path, read-kind check. No general approval or real workspace access.
- Assume a session will not be held by multiple agents for the first version.
  The observed multi-owner occupancy problem is **not a blocker for this
  bounded verification**. This is a human scope decision, not a working
  exclusion primitive or permission to claim reliable external-owner detection.

That last decision does not remove same-owner duplicate-submission protection,
family-wide serialization across Map panels, unknown-result blocking, or the
ban on automatic resends/approvals. Do not interpret multiple UI panels sharing
one execution owner as separate agents authorized to send duplicate requests.

No production source, session manager, UI, real conversation, or runtime event
log was edited. Historical CLI-only sessions are represented by isolated
persisted sessions and real native forks, not by the user's existing sessions.

## Assets and environment

- [Probe runner](../scripts/verify-chat-contract.mjs)
- [Shared local JSON-RPC fault injector](../scripts/fork-contract-transport.mjs)
- [Fault-injector regression tests](../test/fork-contract-transport.test.mjs)
- [Run 1](evidence/chat-contract-windows-1.0.90-0-run1.json)
- [Run 2](evidence/chat-contract-windows-1.0.90-0-run2.json)
- [Earlier safe-fork evidence](fork-contract-windows-verification.md)

| Item | Measured value |
|---|---|
| OS / architecture | Windows / x64 |
| Node | `v24.16.0` |
| Actual runtime | `1.0.90-0` |
| Protocol | `3` |
| SDK SHA-256 | `11801c489647dc7ce8c924c9be7b68f0bca558a67d100739e16fa6ec401a5bd9` |
| Synthetic inference requests | 42 per run, intercepted locally |
| Real model calls | 0 |
| Successful fixture reads | 1 per run, explicitly authorized by the maintainer |

Each evidence file also records the runner and transport hashes. Runtime
versions are checked with `getStatus`, not inferred from the launcher.
Use immutable commit links when citing the assets on the tracker.

The runner subclasses the SDK inference handler and generates deterministic
OpenAI-compatible replies, including tool calls and gated in-flight responses.
It never forwards model requests; WebSockets are rejected and the configured
provider URL is an unused loopback port. This drives the actual runtime agent
loop, native tools, SDK callbacks, events, and persistence without remote
inference. It is not a test of any real model's behavior.

Config discovery, skills, MCP, extensions, remote sessions, and session-store
integration are disabled. Only `view`, `ask_user`, and a never-authorized custom
marker are offered. This isolation differs intentionally from the future
standard-agent configuration; it is not evidence for every production tool.

## Scenario matrix

Each row runs twice unless it describes multiple scenarios.
`PASS` in runner output means the stated evidence assertions passed, including
negative controls. It does **not** mean all native operations are safe.

| Scenario | Observed evidence |
|---|---|
| Text, release, independent cold resume | Receipt/user/assistant correlation preserved; final response recoverable |
| Same native prompt sent twice | Two different message IDs and two user messages; no native deduplication |
| Two connections in one runtime sending the same prompt | Both admitted; frontend or SDK connection count is not a deduplication boundary |
| Authorized native file read | Real `view` returns the synthetic marker to the next inference request |
| Pending custom-tool permission | Processing and visible permission request; no tool execution or follow-up inference until stopped |
| Pending native `ask_user` | Real callback; unanswered wait, no fabricated answer; explicit stop succeeds |
| Rejected permission, contrast | Marker never runs; this build ends the turn after one inference request |
| Stop during gated text generation | Abort, session idle, processing false, activity false |
| Stop races gated completion | Abort wins in both retained samples; no claim that every race outcome was sampled |
| Completion before stop | Previously completed response and its origin remain intact |
| Panel-lifetime analogue | Removing a UI-like subscription does not stop the retained runtime owner; another controlled connection reads active state |
| Normal-unload analogue | Explicit abort, confirmed idle, detach, runtime stop; cold load does not continue inference |
| Runtime hard exit before flush | Acknowledged new message is absent after cold recovery in both samples |
| Same hard exit after native save | New message survives; unfinished turn remains unfinished; no automatic continuation |
| Cut send before forwarding, runtime retained / killed | Caller has no receipt; no new user message observed; no resend |
| Cut send after native reply, runtime retained | Caller has no receipt, but original execution remains active and completes once |
| Cut send after native reply, runtime killed | Receipt was observed by the injector, but new message is absent after cold recovery |
| Injected negative detach response | SDK makes two detach attempts, then exposes an error; other retained attachment remains readable |
| Two real native fork children, two turns each | Each child receives only its own new replies; release/reload preserves message origins; parent conversation unchanged |
| TCP and stdio occupancy probes | Initial create visible, subsequent resume invisible to another runtime; detailed counterexample below |
| Send on disconnected handle | Explicit rejection; no additional user message in persisted history |
| Lose the last session connection | Reconnection is inactive with an unfinished persisted tail; no new inference or resend |

## Submission, message identity, and durability

In this build, the observed identity chain is:

1. `session.send` returns a logical user `messageId`.
2. The matching `user.message.data.messageId` carries that value. Its event
   envelope `id` is a different identity.
3. Root `assistant.message.data.originatingMessageId` identifies that user
   message. Tool-request and final assistant messages can share the same origin.
4. `turnId` links the associated start/end events. A tool-request message is not
   a final response merely because it is an `assistant.message`.

The fork test binds each result to its child session and message ID and checks
the expected child-specific response. No "currently selected branch", last
message heuristic, or callback arrival order is used. Subagent output and
steering are not exercised; do not infer their filtering behavior from this.

**An admitted message is not necessarily flushed to disk.** The hard-exit
contrast records both a send receipt and a live `getEvents` user message before
termination. Without saving, cold recovery contains the older completed setup
turn but not the newly admitted turn. With
`client.rpc.sessions.save({ sessionId })`, the runner reads the actual disk
journal before termination and finds the same message after cold recovery.
This supports buffering as the explanation, rather than cold resume discarding
an already-saved user message.

Use the native save/read path to establish durable history; never directly
rewrite runtime events. The experiment does not prove disk-controller fsync,
power-loss safety, atomicity between send and save, or compatibility of this
save path with older runtime builds. A crash in that gap must remain unknown
when acceptance cannot be resolved, even when the cold history has no new user
message. Missing history is not proof that no execution or tool effect occurred.

The fault injector's receipt is an **experimental oracle**, unavailable to a
caller whose reply was lost. Its legacy `forkRequests` counter counts the
selected RPC method (send/detach here); no fork occurs in these send-fault cases.
Recovery never uses the oracle to authorize a retry. These are selected cuts
before forwarding and after a native reply, not exhaustive crash-instruction
coverage.

## Completion, stop, and unsupported interaction

`session.idle` is observed live but absent from the persisted journal.
`assistant.turn_end` is persisted, including on aborted turns. Thus neither a
turn-end record alone nor some assistant text proves successful completion.
For these foreground cases, the runner checks the terminal events, root
response association, `metadata.isProcessing`, and `metadata.activity`.

The live approval and question cases remain processing without another
inference request or unauthorized marker execution during the controlled wait.
The callback promises remain unanswered. Explicit native abort produces idle
and inactive state; release and an independent runtime's explicit new send
succeed. That verifies session reuse, **not an interactive CLI TUI handoff** or
migration of the original pending request.

The rejection contrast is not the proposed handling of unsupported UI:
rejection ends the turn in the tested build, whereas the agreed behavior is
visible waiting until the human stops it. No conclusion is made about other
tools' rejection behavior.

A native read actually executes with only the maintainer's narrow permission.
Stopping executing shell/edit operations, detached subprocesses, background
agents, and external side effects is not covered. The experiment does not
justify a rollback promise or treating main-agent completion as completion of
all possible background work. The original no-rollback contract still applies.

## Ownership: retained counterexample, explicitly non-blocking

The TCP and stdio scenarios perform this ordered sequence:

1. A creates and completes a synthetic session. B's read-only occupancy query
   reports it in use.
2. A disconnects. B reports it unused.
3. A resumes the same session alone and responds to real session RPCs. B now
   reports it unused, both immediately and after one second.
4. B resumes it afterwards, without a warning. A also does not report B.
5. Attachments are released. A fresh runtime resumes the saved session, and
   the observer still reports it unused.
6. After all competing attachments are gone, an explicitly acquired session
   successfully completes a new turn.

No simultaneous send by independent owners is performed. No conversation
corruption is demonstrated by this scenario. The finding is missed occupancy,
not a claim that single-owner chatting fails. It arises before B attaches:
simultaneous acquisition is not required to reproduce the missing signal.

The earlier `1.0.87-0` / `1.0.88` evidence found detectable live occupancy.
Do not generalize that result to this new build, or label this a proven runtime
regression solely from different probe suites. In particular, neither a false
`checkInUse` result nor absent `alreadyInUse` warning is an exclusion receipt.

On 2026-10-01 the maintainer explicitly chose to assume that one session is
never held by multiple agents, so this problem does not block the current
effort. That assumption must be carried into the specification handoff; this
report supplies no enforcement mechanism. Known occupancy may still be rejected
conservatively, but absence of a warning does not certify exclusive ownership.

## Minimum persistent information implied by the evidence

This is a handoff requirement, not a new implemented data store:

- A durable application submission identity, fixed family/session target, and
  submitted draft revision/content, recorded before dispatch. Native repeat
  sends are distinct deliveries, not idempotent retries.
- Dispatch uncertainty and the logical user message ID once known; retain the
  corresponding event identity and confirmed persistence evidence separately.
- Associated root assistant message/event IDs and turn identity. Preserve the
  difference between a tool-request assistant message and final output.
- Unresolved acceptance, execution, stop, and release facts, with their evidence
  and last observation. A lost connection or timeout must not overwrite an
  uncertain operation with "not accepted" or "stopped".
- The draft revision submitted versus any newer draft revision. Confirmation
  may clear only the former; unresolved submission content is not a draft that
  can be automatically re-sent.

One owner still needs durable family-level admission and duplicate-delivery
control shared by all panels. This runner demonstrates why those are necessary,
not that a production implementation exists. Draft conflict resolution,
restart-safe admission, and shared input history are not implemented or tested.

## Explicitly unverified

- Chat primitives on the minimum `1.0.87` series, and macOS/Linux. Prior fork
  assets can support their stated facts only, not these new chat conclusions.
- Real model inference, production default tool/config discovery, MCP, custom
  agents, reasoning/context configuration inheritance, and App-only tools.
- An actual Map panel, extension unload hook, App host exit, or interactive CLI
  handoff. The runner exercises the corresponding lower-level protocol actions.
- Stopping an already executing side-effecting tool, background-agent/shell
  quiescence, real OS detach failures, disk exhaustion, save failure, and all
  possible crash timing points. Detach failure here is a synthetic RPC reply.
- A durable production submission journal, family scheduler, multi-panel draft
  synchronization, and UI state rendering.

These gaps remain visible to
[确定首版规格的验收标准与实施顺序](https://github.com/jdneo/copilot-chat-map/issues/14).
Closing a bounded evidence ticket must not mark these release/implementation
checks as passed. The multi-owner assumption above is the only ownership
relaxation chosen in this session; do not silently extend it to resend safety.

## Reproduction

Run in this checkout with an explicitly installed runtime. Do not use real
session IDs. The full matrix requires permission to read only its generated
sentinel file; the flag records that consent and must not be supplied on
someone else's behalf.

```powershell
$sdk = "$env:LOCALAPPDATA\Programs\GitHub Copilot\copilot-sdk\index.js"
$runtime = "$env:LOCALAPPDATA\copilot\pkg\win32-x64\1.0.90-0\index.js"

# Tight real-runtime identity/persistence loop, no tool authorization needed.
node .\scripts\verify-chat-contract.mjs "--sdk=$sdk" "--runtime=$runtime" `
  --version=1.0.90-0 --mode=baseline "--output=$env:TEMP\chat-baseline.json"

# Full retained matrix. Repeat with a different output path.
node .\scripts\verify-chat-contract.mjs "--sdk=$sdk" "--runtime=$runtime" `
  --version=1.0.90-0 --allow-fixture-read=true `
  "--output=.\docs\evidence\chat-contract-windows-1.0.90-0-run1.json"

# Narrow the ownership counterexample; does not send while owners compete.
node .\scripts\verify-chat-contract.mjs "--sdk=$sdk" "--runtime=$runtime" `
  --version=1.0.90-0 --case=external-occupancy `
  "--output=$env:TEMP\chat-occupancy.json"

node --test .\test\fork-contract-transport.test.mjs
```

The runner cleans sessions with native deletion and verifies journal absence,
stops only clients/runtimes it created, then removes its exact generated home.
It exits explicitly after saving the report because deliberately lost RPCs can
leave SDK timers outstanding. It does not terminate external owners.

Exploratory failures were corrected before generating the retained corpus:
inference interception must be registered once per runtime, a peer must not
re-register another connection's custom tool, a brand-new empty session may
not yet be persisted, and socket close events must finish before asserting
proxy cleanup. Invalid send options and missing tools did not provide a reliable
immediate-rejection probe; the retained negative case uses a disconnected
handle instead. These are not counted as passing scenario executions.
