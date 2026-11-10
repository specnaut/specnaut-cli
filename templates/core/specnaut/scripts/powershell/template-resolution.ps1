#!/usr/bin/env pwsh
# Dot-sourced by common.ps1, beside it: turning a template name into a file
# path (Resolve-Template) through the override / preset / extension / core
# priority stack. Every script that dot-sources common.ps1 gets it with it.
#
# Kept out of common.ps1 so the repository and feature-path helpers there are
# not buried under the template stack. Defines functions only: dot-sourcing it
# runs nothing.

# A .registry's state and its enabled preset ids, lowest priority number first
# (cli#757), the same three states as _preset_ids_by_priority in the bash twin:
# 'parsed' (a JSON object whose presets is absent or an object: exactly its enabled
# presets, possibly none), 'absent' (no file, or a blank one: directory order,
# quietly) and 'malformed' (anything else: directory order, said once per
# process). One object, never an empty list for two states: PowerShell unrolls @()
# to $null on return, which is how "parsed, nothing enabled" read as "absent".
#
# The sentence is fixed text, because a parser's message quotes the file, and this
# reaches a terminal and an agent's context (cli#719).
function Get-RegistryPresetIds {
    param([Parameter(Mandatory=$true)][string]$RegistryFile)
    $object = [System.Management.Automation.PSCustomObject]
    $raw = if (Test-Path -LiteralPath $RegistryFile -PathType Leaf) { Get-Content -LiteralPath $RegistryFile -Raw }
    if ([string]::IsNullOrWhiteSpace($raw)) { return [PSCustomObject]@{ State = 'absent'; Ids = @() } }
    try {
        $data = ConvertFrom-Json -InputObject $raw
        if ($data -isnot $object) { throw 'not a registry: the top level is not an object' }
        $presets = if ($data.PSObject.Properties['presets']) { $data.presets } else { [PSCustomObject]@{} }
        if ($presets -isnot $object) { throw 'not a registry: presets is not an object' }
        $ids = @($presets.PSObject.Properties |
            Where-Object { $_.Value -is $object -and $_.Value.enabled -ne $false } |
            Sort-Object { if ($null -ne $_.Value.priority) { $_.Value.priority } else { 10 } } |
            ForEach-Object { $_.Name })
        return [PSCustomObject]@{ State = 'parsed'; Ids = $ids }
    } catch {
        if (-not $script:RegistryWarned) {
            $script:RegistryWarned = $true
            [Console]::Error.WriteLine('WARNING: .specnaut/presets/.registry could not be parsed; using alphabetical preset order')
        }
        return [PSCustomObject]@{ State = 'malformed'; Ids = @() }
    }
}

# Resolve a template name to a file path using the priority stack:
#   1. .specnaut/templates/overrides/
#   2. .specnaut/presets/<preset-id>/templates/ (sorted by priority from .registry)
#   3. .specnaut/extensions/<ext-id>/templates/
#   4. .specnaut/templates/ (core)
function Resolve-Template {
    param(
        [Parameter(Mandatory=$true)][string]$TemplateName,
        [Parameter(Mandatory=$true)][string]$RepoRoot
    )

    $base = Join-Path $RepoRoot '.specnaut/templates'

    # Priority 1: Project overrides
    $override = Join-Path $base "overrides/$TemplateName.md"
    if (Test-Path $override) { return $override }

    # Priority 2: Installed presets. A registry that parses decides, even when it
    # enables none (cli#757); absent, blank or malformed, alphabetical directory order.
    $presetsDir = Join-Path $RepoRoot '.specnaut/presets'
    if (Test-Path $presetsDir) {
        $registry = Get-RegistryPresetIds -RegistryFile (Join-Path $presetsDir '.registry')
        $presetIds = if ($registry.State -eq 'parsed') { $registry.Ids } else {
            Get-ChildItem -LiteralPath $presetsDir -Directory -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -notlike '.*' } | Sort-Object Name | ForEach-Object { $_.Name }
        }
        foreach ($presetId in $presetIds) {
            $candidate = Join-Path $presetsDir "$presetId/templates/$TemplateName.md"
            if (Test-Path $candidate) { return $candidate }
        }
    }

    # Priority 3: Extension-provided templates
    $extDir = Join-Path $RepoRoot '.specnaut/extensions'
    if (Test-Path $extDir) {
        foreach ($ext in Get-ChildItem -Path $extDir -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike '.*' } | Sort-Object Name) {
            $candidate = Join-Path $ext.FullName "templates/$TemplateName.md"
            if (Test-Path $candidate) { return $candidate }
        }
    }

    # Priority 4: Core templates
    $core = Join-Path $base "$TemplateName.md"
    if (Test-Path $core) { return $core }

    return $null
}
