#!/usr/bin/env pwsh
# Run one declared quality-gate tier. PowerShell twin of run-gate.sh.
#
#   run-gate.ps1 <fast|full> [--base <rev> | --refs-stdin]
#
# Reads `.specnaut/gates.yml` and runs the commands under `fast_gate:` or
# `full_gate:`, in order, from the repository root.
#
# This and its bash twin are the ONLY places the declaration is parsed. The
# per-child loop and the pre-merge step both call one of them; neither reads
# the file itself. A second parser is a second definition of what a gate is.
#
# It names no test tool, runner or framework, and it never will: the commands
# come from the project's file and are executed verbatim.
#
# Exit codes:
#   0   every command succeeded, OR the tier is not declared
#   1   a command exited non-zero — the tier failed
#   2   usage error
#   3   behind a flag: the candidate is refused, before or after the commands
#   4   behind a flag: every command was omitted, or the tier was emptied on the
#       branch. A skip is never a pass
#   5   --sandbox, --head, --objects or --evidence: this runner is static only, so
#       nothing ran and the gate is NOT RUN, never a pass
#
# Bare, it never reads `.specnaut/impact.json` and is the manual full override.
# Behind a flag it asks gate-impact.ps1 which commands this candidate needs, runs that
# selection with its own loop and reports it; run-gate.sh states the contract.

# $args, not a param block: PowerShell would refuse `--base` as a parameter name.
$scriptArgs = @($args)
$Tier = if ($scriptArgs.Count -gt 0) { [string]$scriptArgs[0] } else { '' }

if ($Tier -ne 'fast' -and $Tier -ne 'full') {
    Write-Error 'usage: run-gate.ps1 <fast|full>'
    exit 2
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
# .specnaut/scripts/powershell/run-gate.ps1 -> the .specnaut directory
$specnautDir = (Resolve-Path (Join-Path $scriptDir '..' '..')).Path
$gates = Join-Path $specnautDir 'gates.yml'
$repoRoot = (Resolve-Path (Join-Path $specnautDir '..')).Path

# One flat list. The format is narrow on purpose (see gates.yml): a top-level
# `<tier>_gate:` key, then `  - ` items until the next top-level key. Quotes
# around an item are stripped as a matched pair only, so a command containing
# a quote is not silently mangled.
function Read-GateTier([string]$File) {
    $key = "${Tier}_gate:"
    $inside = $false
    $found = @()
    foreach ($line in [System.IO.File]::ReadAllLines($File)) {
        if ($line -match '^[^ \t#]') {
            $inside = $line.StartsWith($key, [StringComparison]::Ordinal)
            continue
        }
        if (-not $inside) { continue }
        if ($line -match '^[ \t]*#') { continue }
        if ($line -match '^[ \t]*$') { continue }
        if ($line -match '^[ \t]*-[ \t]*(.*)$') {
            $item = $Matches[1].TrimEnd()
            if ($item.Length -eq 0) { continue }
            if ($item.Length -ge 2) {
                $first = $item[0]; $last = $item[$item.Length - 1]
                if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
                    $item = $item.Substring(1, $item.Length - 2)
                }
            }
            $found += $item
        }
    }
    return , $found
}

function Stop-FlagUsage {
    [Console]::Error.WriteLine('usage: run-gate.ps1 <fast|full> [--base <rev> | --refs-stdin]')
    exit 2
}

$flag = ''
$baseValue = ''
for ($n = 1; $n -lt $scriptArgs.Count; $n++) {
    # Checked first: `switch` follows culture rules, and would read a flag with a zero-width character as the flag.
    if ([string]$scriptArgs[$n] -cnotmatch '\A--[a-z-]+\z') { Stop-FlagUsage }
    switch -CaseSensitive ([string]$scriptArgs[$n]) {
        '--base' {
            if ($flag.Length -gt 0 -or $n + 1 -ge $scriptArgs.Count) { Stop-FlagUsage }
            $n++
            $baseValue = [string]$scriptArgs[$n]
            if ($baseValue.StartsWith('-', [StringComparison]::Ordinal)) { Stop-FlagUsage }
            $flag = '--base'
        }
        '--refs-stdin' {
            if ($flag.Length -gt 0) { Stop-FlagUsage }
            $flag = '--refs-stdin'
        }
        { [Array]::IndexOf([string[]]@('--sandbox', '--head', '--objects', '--evidence'), [string]$_) -ge 0 } {
            [Console]::Error.WriteLine("run-gate.ps1 is static only: it runs no gate in a sandbox, so $_ is refused and the gate is NOT RUN")
            exit 5
        }
        '--parse-gates' {
            if ($n + 2 -ne $scriptArgs.Count) { Stop-FlagUsage }
            Write-Output (Read-GateTier ([string]$scriptArgs[$n + 1]))
            exit 0
        }
        default { Stop-FlagUsage }
    }
}

# One command, with stdin closed. Only a new process can have that: a native
# command inherits this script's stdin and PowerShell has no redirect for it.
# ProcessPath is this very host, where a path built from $PSHOME was fragile. The
# process is also what makes a directory change or an `exit` end with the command.
#
# The command string is the project's and is run verbatim, as bash's `eval` runs
# it. A native command sets $LASTEXITCODE; a failing cmdlet leaves it 0 and sets
# $? to false. Both are failures, and $? is read first because the next statement
# resets it. Invoke-Expression cannot serve: it succeeds whenever its argument parses.
#
# <Owners> reaches the one variable named for them, never the command string; `-`
# means no owners and that none is inherited. Not given, the variable is left alone.
function New-GateCommandStart([string]$Command, [string]$Cwd) {
    $script = "`$global:LASTEXITCODE = 0`n$Command`n" +
    '$gateOk = $?; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; if (-not $gateOk) { exit 1 }; exit 0'
    $psi = [System.Diagnostics.ProcessStartInfo]::new([Environment]::ProcessPath)
    foreach ($a in @('-NoProfile', '-NonInteractive', '-Command', $script)) { $psi.ArgumentList.Add($a) }
    $psi.WorkingDirectory = $Cwd
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    return $psi
}

function Invoke-GateCommand([string]$Command, [string]$Owners = '') {
    $psi = New-GateCommandStart $Command $repoRoot
    if ([string]::Equals($Owners, '-', [StringComparison]::Ordinal)) {
        [void]$psi.Environment.Remove('SPECNAUT_AFFECTED_OWNERS')
    } elseif ($Owners.Length -gt 0) {
        $psi.Environment['SPECNAUT_AFFECTED_OWNERS'] = $Owners
    }
    $process = [System.Diagnostics.Process]::Start($psi)
    $process.StandardInput.Close()
    $process.WaitForExit()
    return $process.ExitCode
}

# Behind a flag, the selected run (_gate_selected.ps1) exits with its own report, or
# goes on to the bare path when gate-impact.ps1 answers `inactive`.
if ($flag.Length -gt 0) {
    . (Join-Path $scriptDir '_gate_selected.ps1')
    $answer = Invoke-SelectedResolver
    if (-not ($answer.Lines.Count -gt 0 -and [string]::Equals($answer.Lines[0], 'inactive', [StringComparison]::Ordinal))) {
        . (Join-Path $scriptDir '_gate_candidate.ps1')
        . (Join-Path $scriptDir '_gate_evidence.ps1')
        Invoke-SelectedRun $answer
    }
}

if (-not (Test-Path -LiteralPath $gates -PathType Leaf)) {
    Write-Output "no $Tier gate declared — $gates is absent, so nothing ran"
    exit 0
}

$commands = Read-GateTier $gates

if ($commands.Count -eq 0) {
    Write-Output "no $Tier gate declared — ${Tier}_gate in $(Split-Path -Leaf $gates) is empty, so nothing ran"
    exit 0
}

$count = $commands.Count
Write-Output "running the $Tier gate — $count command(s) from $(Split-Path -Leaf $gates)"

$i = 0
foreach ($cmd in $commands) {
    $i++
    Write-Output "  [$i/$count] $cmd"
    $rc = Invoke-GateCommand $cmd
    if ($rc -ne 0) {
        Write-Error "  ✗ the $Tier gate failed at command $i/$count (exit $rc): $cmd"
        exit 1
    }
}

Write-Output "✓ the $Tier gate passed — $count of $count command(s)"
exit 0
