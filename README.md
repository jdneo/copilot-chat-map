# Conversation Fork Map

Conversation Fork Map is a Copilot Canvas Extension that opens the current local
session as one read-only lane of grouped Turn Nodes.

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

The extension requires Copilot 1.0.80 or newer. It reads the current local
session's native `events.jsonl` without modifying it and does not create lineage
data merely by opening the map.

## Tests

```powershell
node --test
```
