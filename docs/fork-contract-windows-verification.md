# Safe fork contract: Windows protocol and failure evidence

Date: 2026-09-30.

Task: [验证安全 fork 契约的跨平台与故障边界](https://github.com/jdneo/copilot-chat-map/issues/16).
Contract: [确定安全 fork 的执行归属与验收门槛](https://github.com/jdneo/copilot-chat-map/issues/11#issuecomment-5904848603).

## Status and scope

**This is protocol evidence, not a production fix or a release approval.**
The maintainer narrowed this session's environment requirement to Windows.
Linux and macOS were not tested; no cross-platform safety conclusion follows.
The maintainer also explicitly deferred the rare case of independent runtimes
concurrently loading the same source, including the remaining acquisition race
window. Known occupancy rejection and ordinary live checks remain required.
This deferral is a scope decision, not evidence of native exclusive ownership.
The linked task records the disposition of this bounded verification; it does
not approve or deliver production functionality.

The retained corpus contains **332 scenario executions**, all with zero real
model calls, zero final harness errors, and completed synthetic-session cleanup:

- 114 main-matrix cases per runtime: 19 scenarios, two checkpoints, three repeats.
- 10 live-occupancy/release cases per runtime.
- Six guarded competing-admission cases per runtime.
- 36 unfinished-source resume cases per runtime: six states, three continuation
  settings, two repeats. Separate sensor calibrations are not counted as cases.

An exit code of zero means the evidence assertions and cleanup succeeded.
Several scenarios deliberately reproduce unsafe native behavior. It does
**not** mean every scenario demonstrates a safe production path.

The ordinary same-runtime loaded-source path, checkpoint inheritance, deletion
rollback, and parent cold recovery passed. The occupancy investigation rejects
an assumption about atomic acquisition, **not** the whole contract: resume
warnings alone are insufficient, but a subsequent live occupancy query detected
the observed competing owners. That distinction matters before reopening a
decision or narrowing product scope.

## Environment and assets

| Item | Measured value |
|---|---|
| OS/architecture | Windows, `win32`, `x64` |
| Node | `v22.21.1` |
| Actual runtime versions | `1.0.87-0`, `1.0.88` |
| Runtime protocol | `3` on both |
| SDK bundle SHA-256 | `0a5fe444ce7194d66a8834ef690a54df867f3f8da0c6b57daaba845effe590bc` |
| Runtime launch | Explicit versioned `index.js`, not an unpinned launcher |

Each client checks `getStatus().version` against the requested version. The
tested surfaces include `resumeSession`, `getEvents`, `metadata.snapshot`,
`metadata.isProcessing`, `sessions.checkInUse`, `sessions.fork`,
`sessions.list`, `disconnect`, `deleteSession`, `stop`, and `forceStop`.
The capability-presence fields alone are not evidence of their semantics.

- [Probe runner](../scripts/verify-fork-contract.mjs)
- [Local JSON-RPC fault injector](../scripts/fork-contract-transport.mjs)
- [Main matrix, 1.0.87-0](evidence/fork-contract-windows-1.0.87-0.json)
- [Main matrix, 1.0.88](evidence/fork-contract-windows-1.0.88.json)
- [Live occupancy/release, 1.0.87-0](evidence/fork-ownership-recheck-windows-1.0.87-0.json)
- [Live occupancy/release, 1.0.88](evidence/fork-ownership-recheck-windows-1.0.88.json)
- [Guarded competition, 1.0.87-0](evidence/fork-guarded-race-windows-1.0.87-0.json)
- [Guarded competition, 1.0.88](evidence/fork-guarded-race-windows-1.0.88.json)
- [Unfinished-source resume, 1.0.87-0](evidence/fork-pending-resume-windows-1.0.87-0.json)
- [Unfinished-source resume, 1.0.88](evidence/fork-pending-resume-windows-1.0.88.json)

Use immutable commit links to these assets when recording the resolution on
the tracker, so later changes do not silently replace the referenced evidence.

## Isolation and exact checks

Every invocation creates its own temporary runtime base directory and workspace.
Sources are seven-event, two-completed-turn fixtures with valid event IDs,
parent links, timestamps, and a `session.start`. They are not user sessions.
The earlier checkpoint excludes the second `user.message`; the full checkpoint
includes both turns.

No `send` or `sendAndWait` is called in the scenario cases. The unfinished-source
supplement separately calibrates a blocking model-request sensor with one
explicit control send per runtime; no real model backend is contacted.
Built-in/MCP tools, skills, config discovery, extensions, remote sessions, and
session-store integration are disabled. The supplement offers only one
no-side-effect custom marker to detect unexpected execution. Permission requests
are rejected, not approved. This tests session primitives, not the future branch
agent's production tool configuration.

Parent preservation compares ordered hashes of complete original event objects,
allowing appended system events. Child checks compare every inherited non-start
fixture event, not just message text. Native fork renews the child's start
envelope: session ID and start timestamps change while the start event ID,
producer, schema version, and working-directory context are checked. A child
fork marker must refer to both source and child. No later conversation may leak
past the checkpoint.

Cold recovery stops the original owners and resumes in an independent runtime,
checks the original conversation events, and checks idle state. The rollback
scenario additionally performs a subsequent loaded-source fork. This proves
model-free session usability, **not successful completion of a new model turn**.

Temporary sessions are deleted through the SDK and their absence is checked.
All owned clients are stopped and the exact generated temporary home is removed.
Diagnostic material is captured before the final cleanup; that final cleanup
is a test-only action, not the proposed response to real integrity damage.

Early exploratory harness errors were excluded from the corpus: creation of
the session-state directory, handling the runtime's `.session-operation-locks`
directory, and checking deletion on the SDK client rather than the server RPC
facade. An initially unbounded transport request was interrupted; later runs
use an explicit timeout. Their exact temporary homes were recovered and cleaned
through the SDK separately. No real session was inspected, repaired, or deleted.

## Main matrix

Each row represents six executions on **each** runtime unless otherwise noted.

| Scenario | Result |
|---|---|
| Source loaded in forking runtime | Parent preserved; correct child; both cold-resumable |
| Unloaded source, negative control | Successful child, but parent history lost and cold recovery failed |
| Known other-runtime occupancy | Probe admission guard rejected before any fork |
| Another owner arrives between preflight and resume | Resume accepted on both runtimes; `alreadyInUse: true` warned but did not reject |
| Reject after that resume warning | Only the temporary attachment was released; original owner remained usable and could fork safely |
| Raw fork through a different runtime | Parent history lost despite being loaded elsewhere |
| Two connections, same runtime, source retained | Parent and child checks passed |
| Two attachments, release one, same runtime | Remaining attachment preserved the safe fork path |
| Release the last attachment before fork | Unloaded-source corruption reproduced |
| Simultaneous independent resumes | Both accepted; details below |
| Real registration failure, then child deletion | Child removed, parent fork record remained, parent recovered and could fork again |
| Registration commits, acknowledgement lost | New store read confirmed the record; no deletion or second registration |
| Connection lost after native fork response | Caller result unknown; one child and parent backlink recovered independently |
| Runtime exit before request dispatch | Caller result unknown; no matching child or backlink observed |
| Runtime exit after forwarding request | Outcome sampled at an in-flight cut; details below |
| Runtime exit after native fork response | Caller result unknown; committed child and parent recovered |
| Same native fork request twice | Two distinct children; native request is not idempotent |
| Parent integrity anomaly | Child recovery evidence retained; no automatic parent rewrite |
| Native child deletion fails | Explicit deletion error and incomplete rollback; no retry during the operation |

Registration uses the unchanged repository `createLineageStore` with a private
file. A directory at the target path causes an actual filesystem failure after
child creation. A separate scenario loses acknowledgement *after* a successful
real store commit; that loss is injected at the caller boundary, not a simulated
filesystem rename failure.

Deletion failure uses a separate Windows process holding a synthetic child file
with `FileShare.None`. The real SDK deletion fails with Windows error 32. Child
files remain in these runs; deletion failure must not generally be assumed
atomic. Releasing that handle is test cleanup, not an automatic production retry.

## Occupancy: the counterexample and the important qualification

### What was disproved

Two independent runtimes inspect the same cold source and both observe it as
unused. They concurrently call `resumeSession`, then query
`metadata.snapshot().alreadyInUse`. Both resume calls succeed.

In the main matrix, 1.0.87-0 returned `[false, false]` in **five of six**
simultaneous cases. The follow-up repeated it in **three of ten** cases.
For 1.0.88, every one of the corresponding 16 cases warned one participant.
This is an observed version/timing difference, not a guarantee about 1.0.88.

Therefore neither successful resume nor the construction-time `alreadyInUse`
snapshot is an exclusive-acquisition receipt. Even a warning is advisory:
the runtime still returns a usable session.

These simultaneous-resume observations perform **zero forks and zero sends**.
Original parent history and independent cold recovery passed. They do not
establish that competing resume alone corrupts a session.

### What the follow-up established

In all ten live-recheck cases per runtime:

1. After both resumes, **both** live `checkInUse` calls reported the other owner.
2. An independent observer also saw the source as occupied.
3. Releasing either participant's attachment/client did not hide or disable the
   survivor: the survivor still answered real session RPCs, the observer still
   saw occupancy, and the survivor no longer saw another owner.
4. Parent history remained intact and cold-resumable.

Thus **a missing resume warning is not equivalent to an undetectable conflict**.
The statement "the race makes the agreed contract impossible" would overstate
the evidence.

A further six cases per runtime exercised a throwaway admission sequence:
resume, inspect the warning and live occupancy, check idle state, recheck
occupancy at submission, fork only if eligible, and release only that operation's
attachment. All competing pairs rejected or admitted at most one fork; parent
integrity and recovery passed. This is a model-free protocol probe, not a change
to the production fork service.

### What remains unproved

`checkInUse` remains a point-in-time observation, not a continuous lease. The
experiments do not prove that another independent client cannot arrive after
the last check, ignore warnings, or operate during the native fork. No atomic
exclusive-acquisition primitive was demonstrated.

The factual correction is therefore: retain the same-runtime source attachment
and use live post-resume/submission checks; do not treat resume's snapshot as
ownership. Whether a stronger exclusion guarantee is required or available
has now been deferred by the maintainer for this ticket. This report does not
waive rejection of known external occupancy or claim an atomic lease.

## Unknown results, partial effects, and identity

The local TCP proxy forwards real JSON-RPC traffic without recording credentials.
For committed-result faults it observes a real native response, suppresses it,
then severs the connection or terminates the owned runtime. Its observed child
ID is an **experimental oracle**, not information available to the caller.
Recovery checks use a fresh runtime's native session listing and persisted
source/child evidence.

All 24 transport-loss cases per runtime required the probe's two-second request
timeout. The SDK promise had not settled by that deadline. This establishes the
need for a caller deadline in the tested setup, not that the promise can never
settle. No timed-out request was automatically resent.

The in-flight cut forwards the request and terminates the runtime after a
one-millisecond timer. It does not pin a specific internal filesystem instruction.
In one 1.0.87-0 case, a checkpoint-correct, cold-resumable child existed **without
the parent's fork backlink**. The other five 1.0.87-0 cases and all six 1.0.88
cases had no named candidate in the native listing. Consequently:

- An absent parent backlink does not prove the child was never created.
- An empty native listing is not proof of no partially written/unindexed child.
- The known operation name is useful correlation evidence, not an idempotency
  key: sending the same named fork twice created two children.
- Parent and child observations must be combined with a durable Fork Operation
  record; ambiguous results must remain unknown rather than be guessed away.

The probe records candidates and avoids retry/deletion while results are
unknown. It does not implement a production durable operation journal or prove
restart-safe Map deduplication. The existing Map's in-memory coalescing tests
are not a substitute for that persistence boundary.

## Supplement: loading an unfinished source does not authorize execution

This supplement addresses a different question from concurrent ownership:
when a cold source has an unfinished tail, can loading it for a fork at an
earlier completed checkpoint unexpectedly request a model, execute a tool, or
re-prompt for permission?

Both actual runtimes were tested against six schema-valid fixture tails:
an unanswered user message, a started assistant turn, an assistant tool request,
a started tool, a persisted external-tool request, and a persisted permission
request. Each state was resumed twice with the option omitted, twice with
`continuePendingWork: false`, and twice with `true`.

The request handler overrides both HTTP and WebSocket model transports and never
forwards to an upstream. A separate explicit send reached this handler and
received a synthetic HTTP 400 response on both runtimes. Native `tools.execute`
also demonstrated a rejected permission callback and an invocation of the
no-side-effect marker. Only that calibration marker was temporarily declared
`skipPermission: true`; no actual workspace tool or broad approval was enabled.
Thus zero execution counters in the cases are not just uncalibrated listeners.

| Observation | Default / explicit `false` | Explicit `true` contrast |
|---|---|---|
| Cases across both runtimes | 48 | 24 |
| Model requests caused by resume/fork | 0 | 0 in these fixtures |
| Custom tool handler invocations | 0 | 0 in these fixtures |
| Permission callbacks | 0 | 0 in these fixtures |
| Processing state | False in every case | True for persisted external-tool or permission requests |
| Original persisted event prefix | Preserved | Preserved at the post-resume observation |
| Earlier completed checkpoint fork | Correct; child and parent cold recovery passed | Deliberately not attempted |

The absence of execution with `true` must not be generalized into permission
to use it for fork loading. In the persisted external-tool and permission
cases it reactivated a waiting/processing state. In tool-request/tool-start
fixtures without the corresponding external request, it appended a failed
`tool.execution_complete` with code `interrupted`. These contrast results show
that the unfinished state was recognized, not ignored by the fixture loader.

For the default and explicit-false cases, the source's original events remained
unchanged, and the retained post-release tail contained only resume, fork, and
shutdown bookkeeping in this experiment. There were no added tool-completion
or permission-resolution events. A historical pending permission was still
returned by `permissions.pendingRequests` even though `isProcessing` was false.
Do not claim that default resume necessarily clears every pending record or
turns an unfinished source turn into a completed one.

The runtime can buffer events: the 500-millisecond observation includes both
`getEvents()` and the disk journal, followed by observation after owner release.
The default/false cases continue through the real fork and independent cold
recovery with the model sensor still installed, rather than ending their checks
at a short idle timer.

**Result:** the tested cold-load path satisfies the no-unrequested-execution
condition when continuation is omitted or explicitly disabled. The implementation
should explicitly set `continuePendingWork: false`, send no source message,
never auto-answer pending requests, and retain the idle/eligibility checks.
This is not a guarantee about arbitrary active runtimes, future builds, or
completing a subsequent real model turn.

## Remaining acceptance limits

- Windows x64 only; other OS/architecture/build combinations are unverified.
- No real model calls: six unfinished cold-source states were exercised, but
  active real model/tool work and subsequent chat generation were not.
- No real App/current-session connection adapter or production Map UI was
  changed or validated by these standalone SDK experiments.
- Cooperative race checks passed; continuous native exclusivity is unproved
  and the rare concurrent-runtime window is explicitly deferred for this task.
- Unknown-result recovery is bounded evidence, not a transactional native
  fork/lineage protocol or a claim that every crash cut was enumerated.
- Production failure states, quarantine enforcement, durable deduplication,
  restart recovery, and user-visible errors remain implementation work.

Within the maintainer's Windows-only scope and concurrency deferral, the
previously identified unfinished-source evidence gap is now covered. The task
can record completion of this bounded verification; that must not be worded as
cross-platform certification or acceptance of an unimplemented production fix.

## Reproduction

Run in the repository checkout. The runner accepts explicit SDK and runtime
paths; it does not install packages or use real session IDs.

```powershell
$sdk = "$env:LOCALAPPDATA\Programs\GitHub Copilot\copilot-sdk\index.js"
$version = '1.0.87-0' # Repeat with 1.0.88.
$runtime = "$env:LOCALAPPDATA\copilot\pkg\win32-x64\$version\index.js"

# Tight source-integrity loop: loaded path plus red-capable negative control.
node .\scripts\verify-fork-contract.mjs "--sdk=$sdk" "--runtime=$runtime" `
  "--version=$version" --mode=baseline "--output=$env:TEMP\fork-baseline-$version.json"

# Retained main matrix.
node .\scripts\verify-fork-contract.mjs "--sdk=$sdk" "--runtime=$runtime" `
  "--version=$version" --mode=all --repeats=3 `
  "--output=.\docs\evidence\fork-contract-windows-$version.json"

# Distinguish snapshot warnings from live occupancy and release behavior.
node .\scripts\verify-fork-contract.mjs "--sdk=$sdk" "--runtime=$runtime" `
  "--version=$version" --mode=ownership-recheck --repeats=5 `
  "--output=.\docs\evidence\fork-ownership-recheck-windows-$version.json"

# Probe the corrected candidate admission sequence, without production edits.
node .\scripts\verify-fork-contract.mjs "--sdk=$sdk" "--runtime=$runtime" `
  "--version=$version" --mode=guarded-race --repeats=3 `
  "--output=.\docs\evidence\fork-guarded-race-windows-$version.json"

# Cold-source pending-state contrast, with locally blocked model transport.
node .\scripts\verify-fork-contract.mjs "--sdk=$sdk" "--runtime=$runtime" `
  "--version=$version" --mode=pending-work --repeats=2 `
  "--output=.\docs\evidence\fork-pending-resume-windows-$version.json"
```

The loaded-source checks fail on loss or reordering of original events.
Negative controls explicitly assert the known unsafe behavior; a future runtime
fix changing that behavior will require reviewing those expectations rather
than silently counting a different result as equivalent.
