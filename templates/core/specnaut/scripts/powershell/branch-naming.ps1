#!/usr/bin/env pwsh
# Dot-sourced by create-new-feature.ps1, beside it: how a feature branch is
# named — the next free number and the slug after it. Its bash twin is
# branch-naming.sh, and the two are held to the same scenarios by
# tests/scripts/create_new_feature_number_reuse_test.ts.
#
# Kept out of create-new-feature.ps1 so the script reads as the run it performs
# (parse, name, detect the epic, create, move the card, report), and so a
# change to numbering is made in one short file and its twin, not in the middle
# of a long one. Defines functions only: dot-sourcing it runs nothing.

function Get-HighestNumberFromSpecs {
    param([string]$SpecsDir)

    [long]$highest = 0
    if (Test-Path $SpecsDir) {
        Get-ChildItem -Path $SpecsDir -Directory | ForEach-Object {
            # Match sequential prefixes (>=3 digits), but skip timestamp dirs.
            if ($_.Name -match '^(\d{3,})-' -and $_.Name -notmatch '^\d{8}-\d{6}-') {
                [long]$num = 0
                if ([long]::TryParse($matches[1], [ref]$num) -and $num -gt $highest) {
                    $highest = $num
                }
            }
        }
    }
    return $highest
}

# Extract the highest sequential feature number from a list of branch/ref names.
# Shared by Get-HighestNumberFromBranches, Get-HighestNumberFromRemoteRefs and
# Get-HighestNumberFromHistory.
function Get-HighestNumberFromNames {
    param([string[]]$Names)

    [long]$highest = 0
    foreach ($name in $Names) {
        if ($name -match '^(\d{3,})-' -and $name -notmatch '^\d{8}-\d{6}-') {
            [long]$num = 0
            if ([long]::TryParse($matches[1], [ref]$num) -and $num -gt $highest) {
                $highest = $num
            }
        }
    }
    return $highest
}

function Get-HighestNumberFromBranches {
    param()

    try {
        $branches = git branch -a 2>$null
        if ($LASTEXITCODE -eq 0 -and $branches) {
            $cleanNames = $branches | ForEach-Object {
                $_.Trim() -replace '^\*?\s+', '' -replace '^remotes/[^/]+/', ''
            }
            return Get-HighestNumberFromNames -Names $cleanNames
        }
    } catch {
        [Console]::Error.WriteLine("# warning: could not list git branches for numbering: $_")
    }
    return 0
}

function Get-HighestNumberFromRemoteRefs {
    [long]$highest = 0
    try {
        $remotes = git remote 2>$null
        if ($remotes) {
            foreach ($remote in $remotes) {
                $env:GIT_TERMINAL_PROMPT = '0'
                $refs = git ls-remote --heads $remote 2>$null
                $env:GIT_TERMINAL_PROMPT = $null
                if ($LASTEXITCODE -eq 0 -and $refs) {
                    $refNames = $refs | ForEach-Object {
                        if ($_ -match 'refs/heads/(.+)$') { $matches[1] }
                    } | Where-Object { $_ }
                    $remoteHighest = Get-HighestNumberFromNames -Names $refNames
                    if ($remoteHighest -gt $highest) { $highest = $remoteHighest }
                }
            }
        }
    } catch {
        [Console]::Error.WriteLine("# warning: could not query remote refs for numbering: $_")
    }
    return $highest
}

# Highest feature number any spec directory has EVER carried, per git history.
# PowerShell twin of get_highest_from_history in the bash script, which carries
# the full account of why history and not a stored counter, and of each flag.
#
# In short: merge-close removes a shipped feature's spec directory and the
# branch is deleted after the merge, so only the commit that ADDED the
# directory still holds its number. --no-renames keeps a template-identical
# plan that replaced another one in a single commit from reading as a rename,
# which --diff-filter=A would then drop.
function Get-HighestNumberFromHistory {
    try {
        $paths = git -c core.quotePath=false log --all --no-renames --diff-filter=A `
            --name-only --format= -- .specnaut/specs 2>$null
        if ($paths) {
            $dirNames = $paths | ForEach-Object {
                if ($_ -match '^\.specnaut/specs/([^/]+)/') { $matches[1] }
            } | Where-Object { $_ } | Sort-Object -Unique
            return Get-HighestNumberFromNames -Names $dirNames
        }
    } catch {
        [Console]::Error.WriteLine("# warning: could not read spec history for numbering: $_")
    }
    return 0
}

# Return next available branch number. When SkipFetch is true, queries remotes
# via ls-remote (read-only) instead of fetching.
function Get-NextBranchNumber {
    param(
        [string]$SpecsDir,
        [switch]$SkipFetch
    )

    if ($SkipFetch) {
        # Side-effect-free: query remotes via ls-remote
        $highestBranch = Get-HighestNumberFromBranches
        $highestRemote = Get-HighestNumberFromRemoteRefs
        $highestBranch = [Math]::Max($highestBranch, $highestRemote)
    } else {
        # Fetch all remotes to get latest branch info (suppress errors if no remotes)
        try {
            git fetch --all --prune 2>$null | Out-Null
        } catch {
            # Numbering still works from local refs and history; say so rather
            # than letting a stale remote view pass unannounced.
            [Console]::Error.WriteLine("# warning: git fetch failed; numbering from local refs only: $_")
        }
        $highestBranch = Get-HighestNumberFromBranches
    }

    # Get highest number from ALL specs (not just matching short name)
    $highestSpec = Get-HighestNumberFromSpecs -SpecsDir $SpecsDir

    # ...and from every spec directory history has seen, including shipped
    # ones whose directory and branch are both gone. Read after the fetch
    # above, so freshly fetched remote history counts too.
    $highestHistory = Get-HighestNumberFromHistory

    # Take the maximum of all three
    $maxNum = [Math]::Max([Math]::Max($highestBranch, $highestSpec), $highestHistory)

    # Return next number
    return $maxNum + 1
}

function ConvertTo-CleanBranchName {
    param([string]$Name)

    return $Name.ToLower() -replace '[^a-z0-9]', '-' -replace '-{2,}', '-' -replace '^-', '' -replace '-$', ''
}

# Function to generate branch name with stop word filtering and length filtering
function Get-BranchName {
    param([string]$Description)

    # Common stop words to filter out
    $stopWords = @(
        'i', 'a', 'an', 'the', 'to', 'for', 'of', 'in', 'on', 'at', 'by', 'with', 'from',
        'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
        'do', 'does', 'did', 'will', 'would', 'should', 'could', 'can', 'may', 'might', 'must', 'shall',
        'this', 'that', 'these', 'those', 'my', 'your', 'our', 'their',
        'want', 'need', 'add', 'get', 'set'
    )

    # Convert to lowercase and extract words (alphanumeric only)
    $cleanName = $Description.ToLower() -replace '[^a-z0-9\s]', ' '
    $words = $cleanName -split '\s+' | Where-Object { $_ }

    # Filter words: remove stop words and words shorter than 3 chars (unless they're uppercase acronyms in original)
    $meaningfulWords = @()
    foreach ($word in $words) {
        # Skip stop words
        if ($stopWords -contains $word) { continue }

        # Keep words that are length >= 3 OR appear as uppercase in original (likely acronyms)
        if ($word.Length -ge 3) {
            $meaningfulWords += $word
        } elseif ($Description -match "\b$($word.ToUpper())\b") {
            # Keep short words if they appear as uppercase in original (likely acronyms)
            $meaningfulWords += $word
        }
    }

    # If we have meaningful words, use first 3-4 of them
    if ($meaningfulWords.Count -gt 0) {
        $maxWords = if ($meaningfulWords.Count -eq 4) { 4 } else { 3 }
        $result = ($meaningfulWords | Select-Object -First $maxWords) -join '-'
        return $result
    } else {
        # Fallback to original logic if no meaningful words found
        $result = ConvertTo-CleanBranchName -Name $Description
        $fallbackWords = ($result -split '-') | Where-Object { $_ } | Select-Object -First 3
        return [string]::Join('-', $fallbackWords)
    }
}
