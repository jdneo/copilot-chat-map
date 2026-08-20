[CmdletBinding()]
param()

$source = Join-Path $PSScriptRoot "..\extension"
$copilotHome = if ($env:COPILOT_HOME) {
    $env:COPILOT_HOME
} else {
    Join-Path $HOME ".copilot"
}
$destination = Join-Path $copilotHome "extensions\chat-fork-map"

if (-not (Test-Path (Join-Path $source "extension.mjs") -PathType Leaf)) {
    throw "Conversation Fork Map source was not found at $source"
}

New-Item -ItemType Directory -Path $destination -Force | Out-Null
Get-ChildItem -Path $source -File | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $destination -Force
}

$legacyStorage = Join-Path $destination "storage.mjs"
$legacyGraph = Join-Path $destination "artifacts\fork-graph.json"
$legacyTranscripts = Join-Path $destination "artifacts\transcripts"

if (Test-Path $legacyStorage -PathType Leaf) {
    Remove-Item -LiteralPath $legacyStorage -Force
}
if (Test-Path $legacyGraph -PathType Leaf) {
    Remove-Item -LiteralPath $legacyGraph -Force
}
if (Test-Path $legacyTranscripts -PathType Container) {
    Remove-Item -LiteralPath $legacyTranscripts -Recurse -Force
}

Write-Output "Installed Conversation Fork Map at $destination"
