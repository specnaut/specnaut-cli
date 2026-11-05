# Dot-sourced by gate-impact.ps1. PowerShell twin of _gate_impact_adapter.sh, and the
# one place an adapter runs and the base worktree is made. The adapter is always the
# base's copy: a branch must not choose the code that tells this mechanism how little
# to check.

$script:GateWorktrees = [System.Collections.Generic.List[string]]::new()

# A detached worktree of <commit> at <path>, outside the repository. The hooks directory
# is empty so the checkout runs none of the repository's hooks. Returns its success.
function New-GateWorktree([string]$Commit, [string]$Path, [string]$EmptyHooks) {
    $script:GateWorktrees.Add($Path)
    $r = Invoke-GateGit @('-c', "core.hooksPath=$EmptyHooks", 'worktree', 'add', '--quiet', '--detach', $Path, $Commit)
    return ($r.Code -eq 0)
}

# Safe to call on any exit path, and more than once.
function Remove-GateWorktrees {
    $failed = $false
    foreach ($path in $script:GateWorktrees) {
        if ((Invoke-GateGit @('worktree', 'remove', '--force', $path)).Code -eq 0) { continue }
        # Only this run's own failure prunes. A bare prune would drop the user's stale entries too.
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue }
        $failed = $true
    }
    if ($failed) { [void](Invoke-GateGit @('worktree', 'prune')) }
    $script:GateWorktrees.Clear()
}

# Runs the adapter from <worktree> to describe <tree>; returns its exit. No GIT_* variable
# and no stdin reach it, and its stdout goes to stderr: only the file it writes is its
# answer. It runs in this twin's shell, as a gate command does.
function Invoke-GateAdapter([string]$Command, [string]$Worktree, [string]$Tree, [string]$Commit, [string]$Out) {
    # New-GateCommandStart is run-gate.ps1's, the one caller of this script family.
    $psi = New-GateCommandStart $Command $Worktree
    $psi.RedirectStandardOutput = $true
    foreach ($name in @($psi.Environment.Keys)) { if ($name.StartsWith('GIT_', [StringComparison]::Ordinal)) { [void]$psi.Environment.Remove($name) } }
    $psi.Environment['SPECNAUT_IMPACT_TREE'] = $Tree
    $psi.Environment['SPECNAUT_IMPACT_COMMIT'] = $Commit
    $psi.Environment['SPECNAUT_IMPACT_OUT'] = $Out
    $psi.Environment['SPECNAUT_IMPACT_SCHEMA'] = '1'
    $psi.Environment['SPECNAUT_IMPACT_REPO'] = $repoRoot
    $process = [System.Diagnostics.Process]::Start($psi)
    $process.StandardInput.Close()
    $stdout = $process.StandardOutput.ReadToEnd()
    $process.WaitForExit()
    if ($stdout) { [Console]::Error.Write($stdout) }
    return $process.ExitCode
}
