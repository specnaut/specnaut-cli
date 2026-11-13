# Dot-sourced by run-gate.ps1 and gate-impact.ps1. PowerShell twin of
# _gate_candidate.sh, and the one home of what a candidate is: a tree and the commit
# that holds it. A pass is a statement about one exact tree, so a tree that is dirty,
# or that moved during the run, is refused rather than presented as tested.
#
# Requires $repoRoot. Every git call goes through Invoke-GateGit: this runs inside
# hooks, where git has exported GIT_DIR and friends pointing elsewhere. Output is read
# whole as UTF-8, because PowerShell's own capture splits lines and drops a \r a path
# may hold, and a console code page would mangle anything non-ASCII.
#
# Strings are compared with Test-GateSame, never -ceq, -cne or Sort-Object: those follow
# culture rules, under which a zero-width character compares as nothing at all, and a
# path differing only by one would read as the same path.

function Test-GateSame([string]$A, [string]$B) { return [string]::Equals($A, $B, [StringComparison]::Ordinal) }

# Remove-GateGitEnv - drops every GIT_* variable from a process about to start, as the bash
# twin's explicit_head_clear_env does: not only those `git rev-parse --local-env-vars` lists,
# since others still change what git answers, such as how a pathspec matches.
function Remove-GateGitEnv([System.Diagnostics.ProcessStartInfo]$Psi) {
    foreach ($name in @($Psi.Environment.Keys)) {
        if ($name.StartsWith('GIT_', [StringComparison]::Ordinal)) { [void]$Psi.Environment.Remove($name) }
    }
}

# Invoke-GateProcess - a process with stdin closed and every GIT_* variable gone;
# returns its exit code and its whole stdout. A program that cannot start reads as exit
# 127, as bash has it, so each caller's own check on the exit reports it.
function Invoke-GateProcess([string]$File, [string[]]$Arguments, [string]$Cwd) {
    $psi = [System.Diagnostics.ProcessStartInfo]::new($File)
    foreach ($a in $Arguments) { $psi.ArgumentList.Add($a) }
    if ($Cwd) { $psi.WorkingDirectory = $Cwd }
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = [System.Text.UTF8Encoding]::new($false)
    Remove-GateGitEnv $psi
    try {
        $process = [System.Diagnostics.Process]::Start($psi)
    } catch [System.ComponentModel.Win32Exception] {
        return [pscustomobject]@{ Code = 127; Out = '' }
    }
    $process.StandardInput.Close()
    $stderr = $process.StandardError.ReadToEndAsync()
    $stdout = $process.StandardOutput.ReadToEnd()
    $process.WaitForExit()
    [void]$stderr.Result
    return [pscustomobject]@{ Code = $process.ExitCode; Out = $stdout }
}

function Invoke-GateGit([string[]]$GitArgs) {
    return Invoke-GateProcess 'git' (@('-C', $repoRoot, '-c', 'core.fsmonitor=false') + $GitArgs) ''
}

# Runs git and returns its stdout with the line end gone, or $null when it failed.
function Get-GateGitValue([string[]]$GitArgs) {
    $r = Invoke-GateGit $GitArgs
    if ($r.Code -ne 0) { return $null }
    return $r.Out.TrimEnd("`r", "`n")
}

# The text with anything but printable ASCII replaced, byte by byte, as the bash twin
# does. Causes and commands reach a line a legacy console prints, and a path may hold
# a newline, which would forge a record or a report line.
function ConvertTo-GateAscii([string]$Text) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $out = [System.Text.StringBuilder]::new()
    foreach ($b in $bytes) {
        if ($b -ge 0x20 -and $b -le 0x7e) { [void]$out.Append([char]$b) } else { [void]$out.Append('?') }
    }
    return $out.ToString()
}

# True only at a work tree's top level. Inside another repository's tree, every path
# this mechanism reads would mean something else.
function Test-GateCandidateInRepo {
    $value = Get-GateGitValue @('rev-parse', '--is-inside-work-tree', '--show-prefix')
    return ($null -ne $value -and (Test-GateSame $value 'true'))
}

# Is the work tree still exactly <tree>? Returns the refusal, or $null when it is.
# Status is read with the submodule flag the change set uses, so neither can see a
# change the other cannot.
function Get-GateCandidateRefusal([string]$Tree) {
    $status = Invoke-GateGit @('status', '--porcelain', '--untracked-files=all', '--ignore-submodules=none')
    if ($status.Code -ne 0) { return 'status-failed' }
    if ($status.Out.Length -gt 0) {
        $count = @($status.Out.TrimEnd("`n") -split "`n").Count
        return "dirty-tree: $count path(s) differ from the commit"
    }
    $head = Get-GateGitValue @('rev-parse', '--verify', '--quiet', 'HEAD^{tree}')
    if ($null -eq $head) { return 'no-commit' }
    if (-not (Test-GateSame $head $Tree)) { return "tree-moved: HEAD holds $head" }
    return $null
}

# Sets the candidate from HEAD; returns $false when HEAD holds no commit.
function Set-GateCandidate {
    $script:CandidateCommit = Get-GateGitValue @('rev-parse', '--verify', '--quiet', 'HEAD^{commit}')
    $script:CandidateTree = Get-GateGitValue @('rev-parse', '--verify', '--quiet', 'HEAD^{tree}')
    return ($null -ne $script:CandidateCommit -and $null -ne $script:CandidateTree)
}

# Does every pushed sha hold the candidate tree? Returns the refusal, naming each tree
# that is not, or $null: one pass cannot speak for several trees.
function Get-GateTreeRefusal([string[]]$Shas) {
    $others = ''
    foreach ($sha in $Shas) {
        $tree = Get-GateGitValue @('rev-parse', '--verify', '--quiet', "$sha^{tree}")
        if ($null -eq $tree) { return "local-sha-unknown: $sha" }
        if (-not (Test-GateSame $tree $script:CandidateTree)) { $others += " $sha=$tree" }
    }
    if ($others.Length -eq 0) { return $null }
    return "several-trees: candidate $($script:CandidateTree), pushed$others"
}

# Reads pre-push lines (`<local ref> <local sha> <remote ref> <remote sha>`) and returns
# one fact per ref: `local <sha>` and then `base <commit>`, `zero <remote ref>` or
# `unfetched <sha>`; `malformed <ref>` for a line that is not that. A deleted ref offers
# no tree, so it returns nothing.
function Read-GateCandidateRefs([string]$Text) {
    $hex = '\A[0-9a-f]{40}([0-9a-f]{24})?\z'
    $facts = [System.Collections.Generic.List[string]]::new()
    $lines = $Text -split "`n"
    if ($lines.Count -gt 0 -and $lines[-1].Length -eq 0) { $lines = @($lines | Select-Object -SkipLast 1) }
    foreach ($raw in $lines) {
        $line = $raw.TrimEnd("`r")
        $fields = $line.Split(' ', 4)
        $ref = $fields[0]
        $localSha = if ($fields.Count -gt 1) { $fields[1] } else { '' }
        $remoteRef = if ($fields.Count -gt 2) { $fields[2] } else { '' }
        $remoteSha = if ($fields.Count -gt 3) { $fields[3] } else { '' }
        if ($localSha -cnotmatch $hex -or $remoteSha -cnotmatch $hex) {
            $facts.Add("malformed $ref")
        } elseif ($localSha -cnotmatch '\A0+\z') {
            $facts.Add("local $localSha")
            if ($remoteSha -cmatch '\A0+\z') {
                $facts.Add("zero $remoteRef")
            } else {
                $commit = Get-GateGitValue @('rev-parse', '--verify', '--quiet', "$remoteSha^{commit}")
                if ($null -ne $commit) { $facts.Add("base $commit") } else { $facts.Add("unfetched $remoteSha") }
            }
        }
    }
    return , $facts
}

# The answer gate-impact.ps1 wrote, one field per kind of record. Read here, for run-gate.ps1,
# to keep that file under its size target; what the answer exits is decided there.
function Read-SelectedRecords($Records) {
    $answer = @{
        Tree = ''; Commit = ''; Scope = ''; Owners = ''; Refused = ''; Cause = ''
        Runs = [System.Collections.ArrayList]::new(); Omitted = [System.Collections.ArrayList]::new(); Removed = [System.Collections.ArrayList]::new()
    }
    foreach ($line in $Records) {
        $kind, $rest = $line.Split("`t", 2)
        switch -CaseSensitive ($kind) {
            'candidate' { $answer.Tree, $answer.Commit = $rest.Split("`t", 2) }
            'scope' { $answer.Scope, $answer.Owners = $rest.Split("`t", 2) }
            'refused' { $answer.Refused = $rest }
            'fallback' { $answer.Cause = $rest }
            'removed' { [void]$answer.Removed.Add($rest) }
            'omit' { $reason, $text = $rest.Split("`t", 2); [void]$answer.Omitted.Add("$text ($reason)") }
            'run' { $who, $text = $rest.Split("`t", 2); [void]$answer.Runs.Add(@{ Owners = $who; Command = $text }) }
        }
    }
    return $answer
}
