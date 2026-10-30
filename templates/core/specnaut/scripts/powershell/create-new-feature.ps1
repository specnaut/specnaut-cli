#!/usr/bin/env pwsh
# Create a new feature
[CmdletBinding()]
param(
    [switch]$Json,
    [switch]$AllowExistingBranch,
    [switch]$DryRun,
    [string]$ShortName,
    [Parameter()]
    [long]$Number = 0,
    [switch]$Timestamp,
    [Parameter()]
    [long]$Issue = 0,
    [switch]$Help,
    [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
    [string[]]$FeatureDescription
)
$ErrorActionPreference = 'Stop'

# Show help if requested
if ($Help) {
    Write-Host "Usage: ./create-new-feature.ps1 [-Json] [-DryRun] [-AllowExistingBranch] [-ShortName <name>] [-Number N] [-Timestamp] [-Issue <id>] <feature description>"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Json               Output in JSON format"
    Write-Host "  -DryRun             Compute branch name and paths without creating branches, directories, or files"
    Write-Host "  -AllowExistingBranch  Switch to branch if it already exists instead of failing"
    Write-Host "  -ShortName <name>   Provide a custom short name (2-4 words) for the branch"
    Write-Host "  -Number N           Specify branch number manually (overrides auto-detection)"
    Write-Host "  -Timestamp          Use timestamp prefix (YYYYMMDD-HHMMSS) instead of sequential numbering"
    Write-Host "  -Issue <id>         Link this feature to a backlog issue (positive integer);"
    Write-Host "                      surfaces in JSON output and is persisted to .specnaut/feature.json"
    Write-Host "                      so /task merge can close the loop on the project board."
    Write-Host "  -Help               Show this help message"
    Write-Host ""
    Write-Host "Examples:"
    Write-Host "  ./create-new-feature.ps1 'Add user authentication system' -ShortName 'user-auth'"
    Write-Host "  ./create-new-feature.ps1 'Implement OAuth2 integration for API'"
    Write-Host "  ./create-new-feature.ps1 -Timestamp -ShortName 'user-auth' 'Add user authentication'"
    Write-Host "  ./create-new-feature.ps1 -Issue 42 'Fix the off-by-one in pagination'"
    exit 0
}

# Validate -Issue: must be a positive integer when provided.
if ($Issue -lt 0) {
    Write-Error "Error: -Issue must be a positive integer (got '$Issue')"
    exit 1
}

# Check if feature description provided
if (-not $FeatureDescription -or $FeatureDescription.Count -eq 0) {
    Write-Error "Usage: ./create-new-feature.ps1 [-Json] [-DryRun] [-AllowExistingBranch] [-ShortName <name>] [-Number N] [-Timestamp] <feature description>"
    exit 1
}

$featureDesc = ($FeatureDescription -join ' ').Trim()

# Validate description is not empty after trimming (e.g., user passed only whitespace)
if ([string]::IsNullOrWhiteSpace($featureDesc)) {
    Write-Error "Error: Feature description cannot be empty or contain only whitespace"
    exit 1
}

# Load common functions (Get-RepoRoot, Test-HasGit, Resolve-Template) and the
# branch naming beside them (Get-NextBranchNumber, Get-BranchName)
. "$PSScriptRoot/common.ps1"
. "$PSScriptRoot/branch-naming.ps1"

# Use common.ps1 functions which prioritize .specify over git
$repoRoot = Get-RepoRoot

# Check if git is available at this repo root (not a parent)
$hasGit = Test-HasGit

Set-Location $repoRoot

$specsDir = Join-Path $repoRoot '.specnaut' 'specs'
if (-not $DryRun) {
    New-Item -ItemType Directory -Path $specsDir -Force | Out-Null
}

# Generate branch name
if ($ShortName) {
    # Use provided short name, just clean it up
    $branchSuffix = ConvertTo-CleanBranchName -Name $ShortName
} else {
    # Generate from description with smart filtering
    $branchSuffix = Get-BranchName -Description $featureDesc
}

# Warn if -Number and -Timestamp are both specified
if ($Timestamp -and $Number -ne 0) {
    Write-Warning "[specify] Warning: -Number is ignored when -Timestamp is used"
    $Number = 0
}

# Determine branch prefix
if ($Timestamp) {
    $featureNum = Get-Date -Format 'yyyyMMdd-HHmmss'
    $branchName = "$featureNum-$branchSuffix"
} else {
    # Determine branch number
    if ($Number -eq 0) {
        if ($DryRun -and $hasGit) {
            # Dry-run: query remotes via ls-remote (side-effect-free, no fetch)
            $Number = Get-NextBranchNumber -SpecsDir $specsDir -SkipFetch
        } elseif ($DryRun) {
            # Dry-run without git: local spec dirs only
            $Number = (Get-HighestNumberFromSpecs -SpecsDir $specsDir) + 1
        } elseif ($hasGit) {
            # Check existing branches on remotes
            $Number = Get-NextBranchNumber -SpecsDir $specsDir
        } else {
            # Fall back to local directory check
            $Number = (Get-HighestNumberFromSpecs -SpecsDir $specsDir) + 1
        }
    }

    $featureNum = ('{0:000}' -f $Number)
    $branchName = "$featureNum-$branchSuffix"
}

# GitHub enforces a 244-byte limit on branch names
# Validate and truncate if necessary
$maxBranchLength = 244
if ($branchName.Length -gt $maxBranchLength) {
    # Calculate how much we need to trim from suffix
    # Account for prefix length: timestamp (15) + hyphen (1) = 16, or sequential (3) + hyphen (1) = 4
    $prefixLength = $featureNum.Length + 1
    $maxSuffixLength = $maxBranchLength - $prefixLength

    # Truncate suffix
    $truncatedSuffix = $branchSuffix.Substring(0, [Math]::Min($branchSuffix.Length, $maxSuffixLength))
    # Remove trailing hyphen if truncation created one
    $truncatedSuffix = $truncatedSuffix -replace '-$', ''

    $originalBranchName = $branchName
    $branchName = "$featureNum-$truncatedSuffix"

    Write-Warning "[specify] Branch name exceeded GitHub's 244-byte limit"
    Write-Warning "[specify] Original: $originalBranchName ($($originalBranchName.Length) bytes)"
    Write-Warning "[specify] Truncated to: $branchName ($($branchName.Length) bytes)"
}

# --- Epic detection: one branch per epic, never one per child -------------
# PowerShell twin of the bash block. Same contract, same messages, same
# never-fails-the-run rule. See the bash script for why detection is
# automatic (D1) and why the branch name is unchanged (D2).
#
# The backlog helpers ship as bash only, so this needs a bash on PATH - and
# where there is none, that is stated rather than skipped, exactly as the
# card move below does.
$epicIssue = ''
$epicBranch = ''
if ($Issue -gt 0) {
    $parentSh = Join-Path $repoRoot '.specnaut/scripts/backlog/parent-of.sh'
    $cascadeSh = Join-Path $repoRoot '.specnaut/scripts/backlog/cascade-check.sh'

    # #563 shipped both enumerators for every backend, so the branch that told
    # "this backend ships no enumerator" from "no script installed" is GONE
    # rather than left standing unreachable.
    if (-not (Get-Command bash -ErrorAction SilentlyContinue)) {
        [Console]::Error.WriteLine("# the backlog helpers are bash-only and no bash was found - epic detection did NOT run; treating issue $Issue as standalone")
    } elseif (-not (Test-Path $parentSh) -or -not (Test-Path $cascadeSh)) {
        [Console]::Error.WriteLine("# no backlog parent-of.sh / cascade-check.sh installed - epic detection did NOT run; treating issue $Issue as standalone")
    } else {
        $parentOut = & bash $parentSh $Issue 2>&1
        $parentRc = $LASTEXITCODE
        if ($parentRc -eq 0) {
            $epicIssue = "$parentOut".Trim()
            [Console]::Error.WriteLine("# issue $Issue is a child of epic #$epicIssue - the branch belongs to the epic")
        } elseif ($parentRc -eq 10) {
            # Only 11 says "epic with open children" and only 0 says "none".
            # Anything else is the gate refusing to answer - since #583 that
            # includes exit 3, "could not read the children". See the bash twin
            # for the full account.
            $cascadeOut = & bash $cascadeSh $Issue 2>&1
            $cascadeRc = $LASTEXITCODE
            if ($cascadeRc -eq 11) {
                $epicIssue = "$Issue"
                [Console]::Error.WriteLine("# issue $Issue is an epic with open children - one branch for the whole epic")
            } elseif ($cascadeRc -eq 0) {
                [Console]::Error.WriteLine("# issue $Issue has no parent and no open children - standalone, unchanged")
            } else {
                [Console]::Error.WriteLine("# cascade-check could not answer for issue $Issue (exit $cascadeRc): $cascadeOut")
                [Console]::Error.WriteLine("# epic detection did NOT run - treating it as standalone, which may be wrong if it is an epic")
            }
        } else {
            [Console]::Error.WriteLine("# could not resolve the parent of issue $Issue (exit $parentRc): $parentOut")
            [Console]::Error.WriteLine("# treating it as standalone - the branch is created either way")
        }
    }
}

# Reuse the epic's existing branch rather than minting a second one. The link
# is .specnaut/feature.json, at a fixed path and committed on the branch - so
# this reads git, parses no branch name and introduces no state file.
if ($epicIssue -and $hasGit) {
    $current = (& git rev-parse --abbrev-ref HEAD 2>$null)
    foreach ($b in (& git for-each-ref --format='%(refname:short)' refs/heads 2>$null)) {
        $fj = & git show "${b}:.specnaut/feature.json" 2>$null
        if (-not $fj) { continue }
        try {
            $li = ($fj | ConvertFrom-Json).linked_issue
        } catch {
            [Console]::Error.WriteLine("# warning: branch '$b' has an unreadable .specnaut/feature.json - skipped for epic lookup: $_")
            continue
        }
        if ("$li" -eq $epicIssue) { $epicBranch = $b; break }
    }
    if ($epicBranch) {
        if ($epicBranch -eq $current) {
            [Console]::Error.WriteLine("# already on the epic's branch '$epicBranch' - reusing it, no branch created")
        } else {
            [Console]::Error.WriteLine("# epic #$epicIssue already has branch '$epicBranch' - reusing it, no branch created")
        }
    } else {
        [Console]::Error.WriteLine("# epic #$epicIssue has no branch yet - creating one for it")
    }
}

# Overriding here, after the name was computed, keeps the standalone path
# byte-for-byte unchanged: nothing above this line knows an epic exists.
if ($epicBranch) { $branchName = $epicBranch }

$featureDir = Join-Path $specsDir $branchName
$specFile = Join-Path $featureDir 'plan.md'

if (-not $DryRun) {
    if ($hasGit) {
        $branchCreated = $false
        $branchCreateError = ''
        try {
            $branchCreateError = git checkout -q -b $branchName 2>&1 | Out-String
            if ($LASTEXITCODE -eq 0) {
                $branchCreated = $true
            }
        } catch {
            $branchCreateError = $_.Exception.Message
        }

        if (-not $branchCreated) {
            $currentBranch = ''
            try {
                $currentBranch = (git rev-parse --abbrev-ref HEAD 2>$null).Trim()
            } catch {
                [Console]::Error.WriteLine("# warning: could not read the current branch: $_")
            }
            # Check if branch already exists
            $existingBranch = git branch --list $branchName 2>$null
            if ($existingBranch) {
                if ($AllowExistingBranch) {
                    # If we're already on the branch, continue without another checkout.
                    if ($currentBranch -eq $branchName) {
                        # Already on the target branch — nothing to do
                    } else {
                        # Otherwise switch to the existing branch instead of failing.
                        $switchBranchError = git checkout -q $branchName 2>&1 | Out-String
                        if ($LASTEXITCODE -ne 0) {
                            if ($switchBranchError) {
                                Write-Error "Error: Branch '$branchName' exists but could not be checked out.`n$($switchBranchError.Trim())"
                            } else {
                                Write-Error "Error: Branch '$branchName' exists but could not be checked out. Resolve any uncommitted changes or conflicts and try again."
                            }
                            exit 1
                        }
                    }
                } elseif ($Timestamp) {
                    Write-Error "Error: Branch '$branchName' already exists. Rerun to get a new timestamp or use a different -ShortName."
                    exit 1
                } else {
                    Write-Error "Error: Branch '$branchName' already exists. Please use a different feature name or specify a different number with -Number."
                    exit 1
                }
            } else {
                if ($branchCreateError) {
                    Write-Error "Error: Failed to create git branch '$branchName'.`n$($branchCreateError.Trim())"
                } else {
                    Write-Error "Error: Failed to create git branch '$branchName'. Please check your git configuration and try again."
                }
                exit 1
            }
        }
    } else {
        Write-Warning "[specify] Warning: Git repository not detected; skipped branch creation for $branchName"
    }

    New-Item -ItemType Directory -Path $featureDir -Force | Out-Null

    if (-not (Test-Path -PathType Leaf $specFile)) {
        $template = Resolve-Template -TemplateName 'plan-template' -RepoRoot $repoRoot
        if ($template -and (Test-Path $template)) {
            Copy-Item $template $specFile -Force
        } else {
            New-Item -ItemType File -Path $specFile -Force | Out-Null
        }
    }

    # Set the SPECIFY_FEATURE environment variable for the current session
    $env:SPECIFY_FEATURE = $branchName
}

# --- Move the linked item into In progress -------------------------------
# See the bash twin for why this lives in the script and not in the phase
# prose: creating the branch and moving the card are one command, so one
# cannot happen without the other.
#
# It never fails the run - the branch already exists by here. Every outcome
# is reported, including the ones where nothing moved, because silence is
# what let cards sit in the intake column through whole implementations.
#
# The backlog helpers ship as bash only, so this needs a bash on PATH. Where
# there is none, that is stated rather than skipped.
if (-not $DryRun) {
    if ($Issue -le 0) {
        [Console]::Error.WriteLine("# no -Issue given, so no backlog item was moved")
    } else {
        # On an epic, the card that moves is the EPIC's (D15). A child's card
        # moves when the loop reaches it, not here.
        $moveTarget = if ($epicIssue) { $epicIssue } else { "$Issue" }
        $moveSh = Join-Path $repoRoot '.specnaut/scripts/backlog/move.sh'
        if (-not (Test-Path $moveSh)) {
            [Console]::Error.WriteLine("# no backlog move.sh installed - issue $moveTarget NOT moved; move it by hand")
        } elseif (-not (Get-Command bash -ErrorAction SilentlyContinue)) {
            [Console]::Error.WriteLine("# the backlog helpers are bash-only and no bash was found - issue $moveTarget NOT moved")
        } else {
            $moveOut = & bash $moveSh $moveTarget 'In progress' 2>&1
            if ($LASTEXITCODE -eq 0) {
                [Console]::Error.WriteLine("# $moveOut")
                if ($epicIssue -and $epicIssue -ne "$Issue") {
                    [Console]::Error.WriteLine("# child issue $Issue was NOT moved - its card moves when the loop reaches it")
                }
            } else {
                [Console]::Error.WriteLine("# could not move issue $moveTarget to In progress: $moveOut")
                [Console]::Error.WriteLine("# the branch was created; the board was NOT updated")
            }
        }
    }
}

# Render LINKED_ISSUE as a JSON integer when set, JSON null otherwise.
if ($Issue -gt 0) {
    $linkedIssueValue = $Issue
} else {
    $linkedIssueValue = $null
}

if ($Json) {
    $obj = [PSCustomObject]@{
        BRANCH_NAME = $branchName
        SPEC_FILE = $specFile
        FEATURE_NUM = $featureNum
        LINKED_ISSUE = $linkedIssueValue
        HAS_GIT = $hasGit
    }
    if ($DryRun) {
        $obj | Add-Member -NotePropertyName 'DRY_RUN' -NotePropertyValue $true
    }
    $obj | ConvertTo-Json -Compress
} else {
    Write-Output "BRANCH_NAME: $branchName"
    Write-Output "SPEC_FILE: $specFile"
    Write-Output "FEATURE_NUM: $featureNum"
    if ($Issue -gt 0) {
        Write-Output "LINKED_ISSUE: $Issue"
    }
    Write-Output "HAS_GIT: $hasGit"
    if (-not $DryRun) {
        Write-Output "SPECIFY_FEATURE environment variable set to: $branchName"
    }
}
