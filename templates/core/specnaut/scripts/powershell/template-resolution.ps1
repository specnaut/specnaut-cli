#!/usr/bin/env pwsh
# Dot-sourced by common.ps1, beside it: turning a template name into a file
# path (Resolve-Template) through the override / preset / extension / core
# priority stack. Every script that dot-sources common.ps1 gets it with it.
#
# Kept out of common.ps1 so the repository and feature-path helpers there are
# not buried under the template stack. Defines functions only: dot-sourcing it
# runs nothing.

# The enabled preset ids of a .registry, lowest priority number first. A file
# that does not parse yields none, so the caller takes the alphabetical order,
# and says so once per process: a preset order silently lost is a template
# silently swapped (cli#719). The sentence is fixed text, because a parser's
# message quotes the file, and this reaches a terminal and an agent's context.
function Get-RegistryPresetIds {
    param([Parameter(Mandatory=$true)][string]$RegistryFile)
    try {
        $presets = (Get-Content $RegistryFile -Raw | ConvertFrom-Json).presets
        if (-not $presets) { return @() }
        return @($presets.PSObject.Properties |
            Where-Object { $null -eq $_.Value.enabled -or $_.Value.enabled -ne $false } |
            Sort-Object { if ($null -ne $_.Value.priority) { $_.Value.priority } else { 10 } } |
            ForEach-Object { $_.Name })
    } catch {
        if (-not $script:RegistryWarned) {
            $script:RegistryWarned = $true
            [Console]::Error.WriteLine("WARNING: .specnaut/presets/.registry could not be parsed ($($_.Exception.GetType().Name)); using alphabetical preset order")
        }
        return @()
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

    # Priority 2: Installed presets (sorted by priority from .registry)
    $presetsDir = Join-Path $RepoRoot '.specnaut/presets'
    if (Test-Path $presetsDir) {
        $registryFile = Join-Path $presetsDir '.registry'
        $sortedPresets = @()
        if (Test-Path $registryFile) { $sortedPresets = @(Get-RegistryPresetIds -RegistryFile $registryFile) }

        if ($sortedPresets.Count -gt 0) {
            foreach ($presetId in $sortedPresets) {
                $candidate = Join-Path $presetsDir "$presetId/templates/$TemplateName.md"
                if (Test-Path $candidate) { return $candidate }
            }
        } else {
            # Fallback: alphabetical directory order
            foreach ($preset in Get-ChildItem -Path $presetsDir -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike '.*' }) {
                $candidate = Join-Path $preset.FullName "templates/$TemplateName.md"
                if (Test-Path $candidate) { return $candidate }
            }
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
