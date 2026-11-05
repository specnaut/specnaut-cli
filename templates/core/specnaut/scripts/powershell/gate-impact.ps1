#!/usr/bin/env pwsh
# Decide which of a tier's commands this candidate needs. PowerShell twin of
# gate-impact.sh, whose header states the records this writes. Called by run-gate.ps1,
# and by nothing else:
#
#   gate-impact.ps1 <tier> <commands-file> <records-file> <--base | --refs-stdin> [<rev>]
#
# This file holds every fallback cause and the rule behind them: uncertainty widens.
# What is not shown safe to narrow runs the full tier and names why. It runs nothing of
# the tier itself; a missing `end` is how run-gate.ps1 knows there is no answer. The
# threat model is mistakes: this runs from the candidate's own scripts, so it cannot
# stop a hostile branch, which already controls gates.yml.

param([string]$Tier, [string]$Commands, [string]$Records, [string]$Mode, [string]$BaseArg)
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..' '..' '..')).Path
. (Join-Path $scriptDir '_gate_candidate.ps1')
. (Join-Path $scriptDir '_gate_impact_read.ps1')
. (Join-Path $scriptDir '_gate_impact_adapter.ps1')
. (Join-Path $scriptDir '_gate_impact_graph.ps1')

$Declaration = '.specnaut/impact.json'
$Cause = ''
$Bases = [System.Collections.Generic.List[string]]::new()    # what the change set is computed against
$Compare = [System.Collections.Generic.List[string]]::new()  # those, and the merge-base (FR-006)
$LocalShas = [System.Collections.Generic.List[string]]::new()
$CandidateTree = ''; $CandidateCommit = ''
$Affected = @(); $Selected = $false
$Declared = $null
$Snapshots = @{}
$Utf8 = [System.Text.UTF8Encoding]::new($false)
# Private: mode 0700 on Unix, as bash's mktemp -d makes it. It holds what the adapter wrote.
$Work = [System.IO.Directory]::CreateTempSubdirectory('specnaut-gate-').FullName
[System.IO.File]::WriteAllText($Records, '', $Utf8)

function Write-Record([string[]]$Fields) { [System.IO.File]::AppendAllText($Records, (($Fields -join "`t") + "`n"), $Utf8) }
function Set-Widen([string]$Text) { if ($script:Cause.Length -eq 0) { $script:Cause = ConvertTo-GateAscii $Text } }
function Exit-Inactive { Write-Record @('inactive'); Write-Record @('end'); exit 0 }
function Exit-Refuse([string]$Text) {
    if ($script:CandidateCommit) { Write-Record @('candidate', $script:CandidateTree, $script:CandidateCommit) }
    Write-Record @('refused', (ConvertTo-GateAscii $Text))
    Write-Record @('end')
    exit 0
}
function Add-Base([string]$Commit) { if (-not $Bases.Contains($Commit)) { $Bases.Add($Commit); $Compare.Add($Commit) } }

# FR-005. What a push's lines say comes from the candidate's reader; what each of them
# means for the run is decided here.
function Read-Refs {
    foreach ($fact in (Read-GateCandidateRefs ([Console]::In.ReadToEnd()))) {
        $kind, $value = $fact.Split(' ', 2)
        switch -CaseSensitive ($kind) {
            'local' { $LocalShas.Add($value) }
            'base' { Add-Base $value }
            'malformed' { Set-Widen "refs-malformed: $value" }
            'zero' { Set-Widen "remote-zero: $value" }
            'unfetched' { Set-Widen "remote-unfetched: $value" }
        }
    }
    if ($Bases.Count -eq 0) { Set-Widen 'no-base-in-refs' }
}

function Read-BaseFlag {
    if ($BaseArg.Length -eq 0) { Set-Widen 'base-empty'; return }
    $commit = Get-GateGitValue @('rev-parse', '--verify', '--quiet', '--end-of-options', "$BaseArg^{commit}")
    if ($null -ne $commit) { Add-Base $commit } else { Set-Widen "base-unresolved: $BaseArg" }
}

# FR-006: a narrow base must not launder an earlier change, so the protected paths are
# also compared with where the branch left the default branch.
function Read-MergeBase {
    $r = Invoke-GateProcess ([Environment]::ProcessPath) @('-NoProfile', '-NonInteractive', '-File', (Join-Path $scriptDir 'base-branch.ps1')) $repoRoot
    if ($r.Code -ne 0) { Set-Widen 'default-branch-unresolved'; return }
    $name = $r.Out.Trim()
    foreach ($ref in @("refs/remotes/origin/$name", "refs/heads/$name")) {
        if ($null -eq (Get-GateGitValue @('rev-parse', '--verify', '--quiet', $ref))) { continue }
        $commit = Get-GateGitValue @('merge-base', 'HEAD', $ref)
        if ($null -eq $commit) { break }
        $Compare.Add($commit)
        return
    }
    Set-Widen "merge-base-unresolved: $name"
}

# Whether any commit in reach holds a declaration the work tree does not: one deleted on
# the branch is a change, and must not read as a project that never opted in.
function Test-DeclarationOnASide {
    foreach ($commit in @('HEAD') + @($Compare)) {
        if ((Invoke-GateGit @('cat-file', '-e', "${commit}:$Declaration")).Code -eq 0) { return $true }
    }
    return $false
}

# FR-006, for one path: tracked and regular on every side, and the same on every side.
function Test-Protected([string]$Path) {
    $mine = Get-GateProtectedEntries $CandidateCommit $Path
    if ($mine.Code -eq 2) { Set-Widen "protected-not-regular: $Path"; return $false }
    foreach ($commit in $Compare) {
        $theirs = Get-GateProtectedEntries $commit $Path
        if ($theirs.Code -eq 2) { Set-Widen "protected-not-regular: $Path"; return $false }
        if (-not (Test-GateSame $mine.Text $theirs.Text)) { Set-Widen "protected-changed: $Path"; return $false }
    }
    if ($mine.Code -ne 0) { Set-Widen "protected-not-regular: $Path"; return $false }
    return $true
}

function Read-Declaration {
    $blob = Invoke-GateGit @('cat-file', 'blob', "${CandidateCommit}:$Declaration")
    if ($blob.Code -ne 0) { Set-Widen 'declaration-malformed: unreadable'; return $false }
    $file = Join-Path $Work 'impact.json'
    [System.IO.File]::WriteAllText($file, $blob.Out, $Utf8)
    $script:Declared = Read-GateDeclaration $file
    if ($Declared.Problem.Length -gt 0) { Set-Widen "declaration-malformed: $($Declared.Problem)"; return $false }
    return $true
}

function Test-EveryProtected {
    if (-not (Test-Protected '.specnaut/gates.yml')) { return $false }
    if (-not (Test-Protected '.specnaut/scripts/')) { return $false }
    foreach ($path in $Declared.AdapterFiles) { if (-not (Test-Protected $path)) { return $false } }
    return $true
}

# One adapter run: its exit and its output are all a cause needs, and each is one.
function Read-Side([string]$Side, [string]$Worktree, [string]$Tree, [string]$Commit, [string]$Key) {
    $out = Join-Path $Work "adapter.$Key.out"
    $rc = Invoke-GateAdapter $Declared.AdapterCommand $Worktree $Tree $Commit $out
    if ($rc -ne 0) { Set-Widen "adapter-failed: $Side exit $rc"; return $false }
    if (-not (Test-Path -LiteralPath $out) -or (Get-Item -LiteralPath $out).Length -eq 0) { Set-Widen "adapter-no-output: $Side"; return $false }
    $snapshot = Read-GateSnapshot $out $Commit
    if ($snapshot.Problem.Length -gt 0) { Set-Widen "adapter-$($snapshot.Problem): $Side"; return $false }
    $Snapshots[$Key] = $snapshot.Owners
    return $true
}

# One snapshot per distinct base, plus the candidate's, described by the first base's
# adapter. FR-006 has shown every copy of the adapter to be the same bytes.
function Read-Snapshots {
    $hooks = Join-Path $Work 'nohooks'
    [void][System.IO.Directory]::CreateDirectory($hooks)
    $first = $null
    for ($i = 0; $i -lt $Bases.Count; $i++) {
        $worktree = Join-Path $Work "wt.$i"
        if (-not (New-GateWorktree $Bases[$i] $worktree $hooks)) { Set-Widen "worktree-failed: $($Bases[$i])"; return $false }
        if ($null -eq $first) { $first = $worktree }
        if (-not (Read-Side 'base' $worktree $worktree $Bases[$i] "$i")) { return $false }
    }
    return (Read-Side 'candidate' $first $repoRoot $CandidateCommit 'candidate')
}

function Read-Affected {
    $pairs = [System.Collections.Generic.List[object]]::new()
    for ($i = 0; $i -lt $Bases.Count; $i++) {
        $changes = Get-GateChanges $Bases[$i] $CandidateCommit
        if ($changes.Problem.Length -gt 0) { Set-Widen $changes.Problem; return $false }
        $pairs.Add(@{ Snapshot = $Snapshots["$i"]; Changes = $changes.Paths })
    }
    $unknown = Get-GateUnknownOwner $Declared @($Snapshots.Values)
    if ($null -ne $unknown) { Set-Widen "declaration-malformed: unknown owner $unknown"; return $false }
    $answer = Get-GateAffected $pairs $Snapshots['candidate'] $Declared
    if ($answer.Cause.Length -gt 0) { Set-Widen $answer.Cause; return $false }
    $script:Affected = @($answer.Owners)
    return $true
}

# The chain that can narrow a run: the first stage unable to show narrowing safe widens
# and ends it, and only reaching the end sets Selected.
function Invoke-Decide {
    if ($Cause.Length -gt 0) { return }
    if (-not (Test-Protected $Declaration)) { return }
    if (-not (Read-Declaration)) { return }
    if (-not $Declared.ScopedTiers.Contains($Tier)) { Set-Widen "tier-not-scoped: $Tier"; return }
    if (-not (Test-EveryProtected)) { return }
    $ok = Read-Snapshots
    $drift = Get-GateCandidateRefusal $CandidateTree
    if ($null -ne $drift) { Exit-Refuse $drift }
    if (-not $ok) { return }
    if (-not (Read-Affected)) { return }
    $script:Selected = $true
}

# One command's record. A check naming owners gets those it covers that are affected; one
# naming none covers any. A command with no check always runs, as declared.
function Write-CommandRecord([string]$Command) {
    foreach ($check in $Declared.Checks) {
        if (-not (Test-GateSame $check.Gate $Command)) { continue }
        $hit = @($Affected | Where-Object { $null -eq $check.Owners -or $check.Owners.Contains($_) })
        if ($hit.Count -gt 0) {
            Write-Record @('run', ($hit -join ' '), $check.Scoped)
        } elseif ($null -eq $check.Owners) {
            Write-Record @('omit', 'no-affected-owner', $Command)
        } else {
            Write-Record @('omit', "owners-not-affected: $($check.Owners -join ' ')", $Command)
        }
        return
    }
    Write-Record @('run', '-', $Command)
}

# Commands in a base's tier that the candidate's no longer has. "Full" means the candidate's
# own list, so a branch that drops a command would otherwise pass without it. Read through
# run-gate's parser: a second one would be a second definition.
function Write-Removed([string[]]$Mine) {
    $seen = [System.Collections.Generic.HashSet[string]]::new($Mine, [StringComparer]::Ordinal)
    foreach ($commit in $Compare) {
        $blob = Invoke-GateGit @('cat-file', 'blob', "${commit}:.specnaut/gates.yml")
        if ($blob.Code -ne 0) { continue }
        $file = Join-Path $Work 'gates.base'
        [System.IO.File]::WriteAllText($file, $blob.Out, $Utf8)
        foreach ($command in @(& (Join-Path $scriptDir 'run-gate.ps1') $Tier --parse-gates $file)) {
            if ($seen.Add($command)) { Write-Record @('removed', $command) }
        }
    }
}

function Write-Selection {
    $mine = [string[]]@([System.IO.File]::ReadAllLines($Commands, $Utf8))
    Write-Record @('candidate', $CandidateTree, $CandidateCommit)
    foreach ($commit in $Bases) { Write-Record @('base', $commit) }
    if ($Selected) {
        $scope = if ($Affected.Count -gt 0) { 'owners' } else { 'none' }
        $names = if ($Affected.Count -gt 0) { $Affected -join ' ' } else { '-' }
        Write-Record @('scope', $scope, $names)
        Write-Record @('adapter', $Declared.AdapterCommand)
    } else {
        Write-Record @('scope', 'full', '-')
        Write-Record @('fallback', $Cause)
    }
    Write-Removed $mine
    foreach ($command in $mine) {
        if ($Selected) { Write-CommandRecord $command } else { Write-Record @('run', '-', $command) }
    }
    Write-Record @('end')
}

function Invoke-Main {
    $inRepo = Test-GateCandidateInRepo
    if ($inRepo) {
        if (Test-GateSame $Mode '--base') { Read-BaseFlag } else { Read-Refs }
        Read-MergeBase
    }
    # Get-Item rather than Test-Path, which reads a dangling symlink as absent.
    if ($null -eq (Get-Item -LiteralPath (Join-Path $repoRoot $Declaration) -Force -ErrorAction SilentlyContinue)) {
        if (-not $inRepo -or -not (Test-DeclarationOnASide)) { Exit-Inactive }
    }
    if (-not $inRepo) { Exit-Refuse 'not-a-repository: a declaration needs a work tree to vouch for' }
    if (-not (Set-GateCandidate)) { Exit-Refuse 'no-commit' }
    $refusal = Get-GateCandidateRefusal $CandidateTree
    if ($null -ne $refusal) { Exit-Refuse $refusal }
    $refusal = Get-GateTreeRefusal @($LocalShas)
    if ($null -ne $refusal) { Exit-Refuse $refusal }
    Invoke-Decide
    Write-Selection
}

try {
    Invoke-Main
} finally {
    Remove-GateWorktrees
    if (Test-Path -LiteralPath $Work) { Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue }
}
exit 0
