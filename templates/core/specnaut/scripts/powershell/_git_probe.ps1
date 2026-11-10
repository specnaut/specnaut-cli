#!/usr/bin/env pwsh
# Dot-sourced by common.ps1, beside it: the PowerShell twin's one git probe. Its
# bash twin is _git_probe in _git_probe.sh, and the two are held to the same
# scenarios by tests/scripts/git_probe_twins_test.ts. Defines a function only:
# dot-sourcing it runs nothing.

# The one git probe (cli#719): git's stdout, or $null when it did not answer. A normal "no" is
# quiet: no .git here, or a failure -NormalIf explains (git exits 0 on it). A .git that git cannot
# read says so, once per process, because the caller then carries on as if there were no repository.
# The sentence is fixed text: git's stderr names paths and config, and this reaches an agent. A
# non-zero exit stays an exit under any caller's preference: the catch is for a git that cannot start.
function Invoke-GitProbe {
    param(
        [Parameter(Mandatory = $true)][string]$WorkDir,
        [Parameter(Mandatory = $true)][string[]]$GitArgs,
        [string[]]$NormalIf
    )
    $PSNativeCommandUseErrorActionPreference = $false
    $hasMarker = Test-Path -LiteralPath (Join-Path $WorkDir '.git')
    $problem = $null
    if (Get-Command git -ErrorAction SilentlyContinue) {
        try {
            $out = & git -C $WorkDir @GitArgs 2>$null
            $code = $LASTEXITCODE
            if ($code -eq 0) { return $out }
            if ($NormalIf) {
                $null = & git -C $WorkDir @NormalIf 2>$null
                if ($LASTEXITCODE -eq 0) { return $null }
            }
            if ($hasMarker) { $problem = "git exited $code reading this repository" }
        } catch {
            $problem = "git could not be started ($($_.Exception.GetType().Name))"
        }
    } elseif ($hasMarker) {
        $problem = '.git is present but git is not on PATH'
    }
    if ($problem -and -not $script:GitProbeWarned) {
        $script:GitProbeWarned = $true
        [Console]::Error.WriteLine("WARNING: $problem; continuing without git")
    }
    return $null
}
