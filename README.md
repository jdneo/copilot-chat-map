# Conversation Fork Map

Conversation Fork Map is a Copilot Canvas Extension that restores a local
Conversation Family as session lanes. Shared turns remain in the parent lane,
each child starts after its Fork Checkpoint, and the Current Session is focused.
Select a completed turn and use `+ Fork to CLI` to create a CLI-only child at
that checkpoint. The empty child node shows the exact `copilot --resume=<id>`
command needed to continue it.

## Run from source

Install the source into the user extension directory, reload extensions in
Copilot, then run:

```text
/fork-map
```

The same command focuses and refreshes the existing logical panel. A natural
language request to open the Conversation Fork Map can also use the declared
canvas.

## Install for the current user

```powershell
pwsh -File .\scripts\install-user-extension.ps1
```

Reload extensions after installation. `COPILOT_HOME` is respected when set;
otherwise the extension is installed below `$HOME/.copilot/extensions`.
The installer replaces stale top-level implementation files and removes legacy
prototype snapshots while preserving the current `lineage-v1.json` index. It
never reads, writes, or removes anything below the native `session-state`
directory.

The extension requires Copilot 1.0.80 or newer. It reads the current local
session's native `events.jsonl` without modifying it. Structured lineage is
created lazily after the first successful fork and stored under the extension's
local `artifacts` directory.

Before presenting a working map, the provider verifies Canvas rendering, local
session identity, fork and metadata RPCs, occupancy checks, and a readable local
event-log root. Missing requirements are reported as a
specific unsupported state instead of an empty map.

Session names, summaries, modification times, and availability are read from
current local session metadata whenever the map refreshes. Corrupt lineage is
shown as an error instead of being rendered as a successful family.

## Tests

```powershell
node --test
```
