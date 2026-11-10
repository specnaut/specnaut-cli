#!/usr/bin/env pwsh
# Setup implementation plan for a feature

[CmdletBinding()]
param(
    [switch]$Json,
    [switch]$Help
)

$ErrorActionPreference = 'Stop'

# Show help if requested
if ($Help) {
    Write-Output "Usage: ./setup-plan.ps1 [-Json] [-Help]"
    Write-Output "  -Json     Output results in JSON format"
    Write-Output "  -Help     Show this help message"
    exit 0
}

# Load common functions
. "$PSScriptRoot/common.ps1"

# A status line: stdout in text mode; stderr under -Json, where stdout is the JSON
# object alone (cli#749). The bash twin prints the same lines.
function Write-Status([string]$Line) {
    if ($Json) { [Console]::Error.WriteLine($Line) } else { Write-Output $Line }
}

# Get all paths and variables from common functions
$paths = Get-FeaturePathsEnv

# Check if we're on a proper feature branch (only for git repos)
if (-not (Test-FeatureBranch -Branch $paths.CURRENT_BRANCH -HasGit $paths.HAS_GIT)) { 
    exit 1 
}

# Ensure the feature directory exists
New-Item -ItemType Directory -Path $paths.FEATURE_DIR -Force | Out-Null

# Seed the plan from the template, but NEVER over an existing one.
# create-new-feature.ps1 performs the identical copy and guards it with
# Test-Path -PathType Leaf; only this one was unguarded — and it forced the
# overwrite explicitly. See scripts/bash/setup-plan.sh for the full account.
if (Test-Path -PathType Leaf $paths.IMPL_PLAN) {
    Write-Status "Plan already exists at $($paths.IMPL_PLAN) - left untouched"
} else {
    $template = Resolve-Template -TemplateName 'plan-template' -RepoRoot $paths.REPO_ROOT
    if ($template -and (Test-Path $template)) {
        Copy-Item $template $paths.IMPL_PLAN -Force
        Write-Status "Copied plan template to $($paths.IMPL_PLAN)"
    } else {
        Write-Status "Warning: Plan template not found"
        # Create a basic plan file if template doesn't exist
        New-Item -ItemType File -Path $paths.IMPL_PLAN -Force | Out-Null
    }
}

# Output results
if ($Json) {
    $result = [PSCustomObject]@{ 
        FEATURE_SPEC = $paths.FEATURE_SPEC
        IMPL_PLAN = $paths.IMPL_PLAN
        SPECS_DIR = $paths.FEATURE_DIR
        BRANCH = $paths.CURRENT_BRANCH
        HAS_GIT = $paths.HAS_GIT
    }
    $result | ConvertTo-Json -Compress
} else {
    Write-Output "FEATURE_SPEC: $($paths.FEATURE_SPEC)"
    Write-Output "IMPL_PLAN: $($paths.IMPL_PLAN)"
    Write-Output "SPECS_DIR: $($paths.FEATURE_DIR)"
    Write-Output "BRANCH: $($paths.CURRENT_BRANCH)"
    Write-Output "HAS_GIT: $($paths.HAS_GIT)"
}
