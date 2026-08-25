[CmdletBinding()]
param()

$source = Join-Path (Split-Path -Parent $PSScriptRoot) "extension"
$copilotHome = if ($env:COPILOT_HOME) {
    $env:COPILOT_HOME
} else {
    Join-Path $HOME ".copilot"
}
$extensionsRoot = Join-Path $copilotHome "extensions"
$destination = Join-Path $extensionsRoot "chat-fork-map"

if (-not (Test-Path (Join-Path $source "extension.mjs") -PathType Leaf)) {
    throw "Conversation Fork Map source was not found at $source"
}

New-Item -ItemType Directory -Path $destination -Force | Out-Null
$sourceFiles = @(Get-ChildItem -Path $source -File)
$sourceFiles | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $destination -Force
}
$managedNames = @($sourceFiles | ForEach-Object { $_.Name })
Get-ChildItem -LiteralPath $destination -File -Force |
    Where-Object { $_.Name -notin $managedNames } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
Get-ChildItem -LiteralPath $destination -Directory -Force |
    Where-Object { $_.Name -ne "artifacts" } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }

$artifacts = Join-Path $destination "artifacts"
$legacyGraph = Join-Path $artifacts "fork-graph.json"
$legacyTranscripts = Join-Path $artifacts "transcripts"

if (Test-Path $legacyGraph -PathType Leaf) {
    Remove-Item -LiteralPath $legacyGraph -Force
}
if (Test-Path $legacyTranscripts -PathType Container) {
    Remove-Item -LiteralPath $legacyTranscripts -Recurse -Force
}

Write-Output "Installed Conversation Fork Map at $destination"
