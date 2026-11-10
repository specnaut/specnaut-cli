#!/usr/bin/env pwsh
# Common PowerShell functions analogous to common.sh

# The nearest directory at or above StartDir holding a .specnaut this user owns
# (cli#750). A filesystem or drive root never counts: a marker there would claim
# every directory on the machine. Mirrors find_specnaut_root in bash/common.sh.
function Find-SpecnautRoot {
    param([string]$StartDir = (Get-Location).Path)
    # -LiteralPath: a path may hold wildcard characters ([, ], *, ?)
    $resolved = Resolve-Path -LiteralPath $StartDir -ErrorAction SilentlyContinue
    $current = if ($resolved) { $resolved.Path } else { $null }
    while ($current -and $current -ne [System.IO.Path]::GetPathRoot($current)) {
        if (Test-OwnedDirectory (Join-Path $current '.specnaut')) { return $current }
        $current = Split-Path $current -Parent
    }
    return $null
}

# A directory this user owns. On Windows the ACL names its owner: this account,
# or the Administrators group an elevated account's files belong to, when this
# account holds that role. Elsewhere the owner's name is this user's; the
# trailing separator makes Get-Item follow a link, as bash's -O does.
function Test-OwnedDirectory {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return $false }
    if ($IsWindows) {
        $acl = Get-Acl -LiteralPath $Path -ErrorAction SilentlyContinue
        if (-not $acl) { return $false }
        $owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier])
        $me = [System.Security.Principal.WindowsIdentity]::GetCurrent()
        if ($owner -eq $me.User) { return $true }
        $admins = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
        return ($owner -eq $admins) -and [System.Security.Principal.WindowsPrincipal]::new($me).IsInRole($admins)
    }
    $item = Get-Item -LiteralPath "$Path/" -Force -ErrorAction SilentlyContinue
    return ($null -ne $item) -and ($item.User -eq [Environment]::UserName)
}

# The project root: the directory holding .specnaut (cli#750). Installed, it is the
# project this script is installed in (its own ../.. is that .specnaut), wherever it
# runs: a .specnaut planted above the working directory cannot claim it. Run in place
# (the templates tree), the nearest .specnaut above the working directory, then git's
# top level, then the script's own location. Mirrors get_repo_root in bash/common.sh.
function Get-RepoRoot {
    $specnautDir = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    if ((Split-Path $specnautDir -Leaf) -eq '.specnaut') { return (Split-Path $specnautDir -Parent) }
    $found = Find-SpecnautRoot
    if ($found) { return $found }
    $result = Invoke-GitProbe -WorkDir '.' -GitArgs @('rev-parse', '--show-toplevel')
    if ($null -ne $result) { return $result }
    return (Split-Path $specnautDir -Parent)
}

function Get-CurrentBranch {
    # First check if SPECIFY_FEATURE environment variable is set
    if ($env:SPECIFY_FEATURE) {
        return $env:SPECIFY_FEATURE
    }

    # Then git, when the root is in a work tree (see Test-HasGit)
    $repoRoot = Get-RepoRoot
    if (Test-HasGit) {
        # An unborn HEAD fails this too and is normal: HEAD is still a symbolic ref.
        $result = Invoke-GitProbe -WorkDir $repoRoot -GitArgs @('rev-parse', '--abbrev-ref', 'HEAD') `
            -NormalIf @('symbolic-ref', '-q', 'HEAD')
        if ($null -ne $result) { return $result }
    }

    $latest = Get-LatestFeatureDir (Join-Path $repoRoot '.specnaut' 'specs')
    if ($latest) { return $latest }
    return 'main'
}

# The name of the latest feature directory under SpecsDir: the newest timestamp
# prefix, else the highest number; $null when there is none. Mirrors
# _latest_feature_dir in bash/common.sh.
function Get-LatestFeatureDir {
    param([string]$SpecsDir)
    if (-not (Test-Path -LiteralPath $SpecsDir)) { return $null }
    $latestFeature = $null
    $highest = 0
    $latestTimestamp = ''
    foreach ($dir in Get-ChildItem -LiteralPath $SpecsDir -Directory) {
        if ($dir.Name -match '^(\d{8}-\d{6})-') {
            # Timestamp-based branch: compare lexicographically
            if ($matches[1] -gt $latestTimestamp) { $latestTimestamp = $matches[1]; $latestFeature = $dir.Name }
        } elseif ($dir.Name -match '^(\d{3,})-') {
            $num = [long]$matches[1]
            # A number wins only while no timestamp branch has been found
            if ($num -gt $highest) { $highest = $num; if (-not $latestTimestamp) { $latestFeature = $dir.Name } }
        }
    }
    return $latestFeature
}

# Whether the root is inside a git work tree, asked of git at the root (cli#750): a
# project nested in a parent repository works on its branches.
function Test-HasGit {
    return (Invoke-GitProbe -WorkDir (Get-RepoRoot) -GitArgs @('rev-parse', '--is-inside-work-tree')) -eq 'true'
}

# Strip a single optional path segment (e.g. gitflow "feat/004-name" -> "004-name").
# Only when the full name is exactly two slash-free segments; otherwise returns the raw name.
function Get-SpecnautEffectiveBranchName {
    param([string]$Branch)
    if ($Branch -match '^([^/]+)/([^/]+)$') {
        return $Matches[2]
    }
    return $Branch
}

# True when a branch name follows the feature-branch convention: a sequential
# prefix of 3+ digits, or a timestamp prefix, excluding malformed timestamps
# (7-or-8 digit date + 6-digit time with no trailing slug).
#
# Extracted so Test-FeatureBranch and the resolution cross-check in
# Get-FeaturePathsEnv cannot come to disagree about what a feature branch is.
# Mirrors is_feature_branch_name() in scripts/bash/common.sh.
function Test-FeatureBranchName {
    param([string]$Branch)
    $hasMalformedTimestamp = ($Branch -match '^[0-9]{7}-[0-9]{6}-') -or ($Branch -match '^(?:\d{7}|\d{8})-\d{6}$')
    if (($Branch -match '^[0-9]{3,}-') -and (-not $hasMalformedTimestamp)) { return $true }
    return [bool]($Branch -match '^\d{8}-\d{6}-')
}

function Test-FeatureBranch {
    param(
        [string]$Branch,
        [bool]$HasGit = $true
    )
    
    # For non-git repos, we can't enforce branch naming but still provide output
    if (-not $HasGit) {
        Write-Warning "[specify] Warning: Git repository not detected; skipped branch validation"
        return $true
    }

    $raw = $Branch
    $Branch = Get-SpecnautEffectiveBranchName $raw

    if (-not (Test-FeatureBranchName $Branch)) {
        [Console]::Error.WriteLine("ERROR: Not on a feature branch. Current branch: $raw")
        [Console]::Error.WriteLine("Feature branches should be named like: 001-feature-name, 1234-feature-name, or 20260319-143022-feature-name")
        return $false
    }
    return $true
}

# Resolve .specnaut/specs/<feature-dir> by numeric/timestamp prefix (mirrors scripts/bash/common.sh find_feature_dir_by_prefix).
function Find-FeatureDirByPrefix {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][string]$Branch
    )
    $specsDir = Join-Path $RepoRoot '.specnaut' 'specs'
    $branchName = Get-SpecnautEffectiveBranchName $Branch

    $prefix = $null
    if ($branchName -match '^(\d{8}-\d{6})-') {
        $prefix = $Matches[1]
    } elseif ($branchName -match '^(\d{3,})-') {
        $prefix = $Matches[1]
    } else {
        return (Join-Path $specsDir $branchName)
    }

    $dirMatches = @()
    if (Test-Path -LiteralPath $specsDir -PathType Container) {
        $dirMatches = @(Get-ChildItem -LiteralPath $specsDir -Filter "$prefix-*" -Directory -ErrorAction SilentlyContinue)
    }

    if ($dirMatches.Count -eq 0) {
        return (Join-Path $specsDir $branchName)
    }
    if ($dirMatches.Count -eq 1) {
        return $dirMatches[0].FullName
    }
    $names = ($dirMatches | ForEach-Object { $_.Name }) -join ' '
    [Console]::Error.WriteLine("ERROR: Multiple spec directories found with prefix '$prefix': $names")
    [Console]::Error.WriteLine('Please ensure only one spec directory exists per prefix.')
    return $null
}

# Branch-based prefix resolution; mirrors bash get_feature_paths failure (stderr + exit 1).
function Get-FeatureDirFromBranchPrefixOrExit {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][string]$CurrentBranch
    )
    $resolved = Find-FeatureDirByPrefix -RepoRoot $RepoRoot -Branch $CurrentBranch
    if ($null -eq $resolved) {
        [Console]::Error.WriteLine('ERROR: Failed to resolve feature directory')
        exit 1
    }
    return $resolved
}

# The "feature_directory" of .specnaut/feature.json; $null when it names none.
function Get-FeatureJsonDirectory {
    param([Parameter(Mandatory = $true)][string]$RepoRoot)
    $featureJson = Join-Path $RepoRoot '.specnaut/feature.json'
    if (-not (Test-Path $featureJson)) { return $null }
    $featureJsonRaw = Get-Content -LiteralPath $featureJson -Raw
    try {
        return ($featureJsonRaw | ConvertFrom-Json).feature_directory
    } catch {
        [Console]::Error.WriteLine("ERROR: Failed to parse .specnaut/feature.json: $_")
        exit 1
    }
}

function Get-FeaturePathsEnv {
    $repoRoot = Get-RepoRoot
    $currentBranch = Get-CurrentBranch
    $hasGit = Test-HasGit

    # Resolve feature directory.  Priority:
    #   1. SPECIFY_FEATURE_DIRECTORY env var (explicit override)
    #   2. .specnaut/feature.json "feature_directory" key (persisted by /task plan)
    #   3. Branch-name-based prefix lookup (same as scripts/bash/common.sh)
    $featureDirSource = 'env'
    $featureDir = $env:SPECIFY_FEATURE_DIRECTORY
    if (-not $featureDir) {
        $featureDirSource = 'feature.json'
        $featureDir = Get-FeatureJsonDirectory -RepoRoot $repoRoot
    }
    if (-not $featureDir) {
        $featureDirSource = 'branch'
        $featureDir = Get-FeatureDirFromBranchPrefixOrExit -RepoRoot $repoRoot -CurrentBranch $currentBranch
    } elseif (-not [System.IO.Path]::IsPathRooted($featureDir)) {
        # Normalize relative paths to absolute under repo root
        $featureDir = Join-Path $repoRoot $featureDir
    }

    # A resolution that contradicts the branch is an error, not an output: only
    # the feature.json rule can disagree with it (see scripts/bash/common.sh).
    if ($featureDirSource -eq 'feature.json' -and $hasGit) {
        $effBranch = Get-SpecnautEffectiveBranchName $currentBranch
        if ((Test-FeatureBranchName $effBranch) -and ((Split-Path -Leaf $featureDir) -ne $effBranch)) {
            [Console]::Error.WriteLine("ERROR: .specnaut/feature.json resolves to a different feature than the current branch.")
            [Console]::Error.WriteLine("  current branch:  $effBranch")
            [Console]::Error.WriteLine("  feature.json:    $(Split-Path -Leaf $featureDir)")
            [Console]::Error.WriteLine("  resolved path:   $featureDir")
            [Console]::Error.WriteLine("Refusing to act on a contradiction: writing here would touch the other feature's files.")
            [Console]::Error.WriteLine("Fix .specnaut/feature.json to name the current feature, or set SPECIFY_FEATURE_DIRECTORY to override deliberately.")
            exit 1
        }
    }

    [PSCustomObject]@{
        REPO_ROOT     = $repoRoot
        CURRENT_BRANCH = $currentBranch
        HAS_GIT       = $hasGit
        FEATURE_DIR   = $featureDir
        FEATURE_SPEC  = Join-Path $featureDir 'plan.md'
        IMPL_PLAN     = Join-Path $featureDir 'plan.md'
        TASKS         = Join-Path $featureDir 'tasks.md'
    }
}

function Test-FileExists {
    param([string]$Path, [string]$Description)
    if (Test-Path -Path $Path -PathType Leaf) {
        Write-Output "  ✓ $Description"
        return $true
    } else {
        Write-Output "  ✗ $Description"
        return $false
    }
}

# The git probe (Invoke-GitProbe) and template resolution (Resolve-Template) live
# beside this file; every caller of common.ps1 keeps getting them from here.
. "$PSScriptRoot/_git_probe.ps1"
. "$PSScriptRoot/template-resolution.ps1"
