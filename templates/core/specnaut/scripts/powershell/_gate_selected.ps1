# Dot-sourced by run-gate.ps1, and only behind a flag: the selected run. PowerShell twin of
# _gate_selected.sh, which states the contract. It asks gate-impact.ps1 which commands this
# candidate needs, runs that selection through run-gate.ps1's Invoke-GateCommand, and
# reports what it ran and what it did not. Requires $Tier, $flag, $baseValue, $gates,
# $scriptDir, Read-GateTier and Invoke-GateCommand.

# Exit 3 before anything ran. A refusal still prints the whole report, so a caller
# reads one shape; there is no result to record, so no evidence is written.
function Stop-Refused([string]$Text) {
    Write-Output "candidate: refused ($Text)"
    foreach ($label in @('scope', 'fallback', 'removed', 'omitted', 'ran')) { Write-Output "${label}: none" }
    Write-Output 'evidence: unwritten (candidate refused)'
    [Console]::Error.WriteLine("the $Tier gate refused the candidate: $Text")
    exit 3
}

# Every activated run prints every label, `none` where there is nothing to say: a
# line missing from a report cannot be told from a report that was cut short.
function Write-ReportLabel([string]$Label, $Items) {
    if (@($Items).Count -eq 0) { Write-Output "${Label}: none"; return }
    foreach ($item in $Items) { Write-Output "${Label}: $(ConvertTo-GateAscii $item)" }
}

# Behind a flag. Returns only when the answer is `inactive`, for the bare path to run
# with nothing printed. An answer with no final `end` is no answer: it never reads as
# a pass, and whether to widen is not this file's to decide.
function Invoke-SelectedResolver {
    $work = [System.IO.Directory]::CreateTempSubdirectory('specnaut-gate-run-').FullName
    $utf8 = [System.Text.UTF8Encoding]::new($false)
    $list = if (Test-Path -LiteralPath $gates -PathType Leaf) { Read-GateTier $gates } else { @() }
    $commandsFile = Join-Path $work 'commands'
    $recordsFile = Join-Path $work 'records'
    [System.IO.File]::WriteAllLines($commandsFile, [string[]]@($list), $utf8)
    $rc = 0
    try {
        $null = & (Join-Path $scriptDir 'gate-impact.ps1') $Tier $commandsFile $recordsFile $flag $baseValue
        $rc = $LASTEXITCODE
    } catch {
        [Console]::Error.WriteLine("run-gate: gate-impact stopped ($($_.Exception.GetType().Name))")
        $rc = 70
    }
    $lines = if (Test-Path -LiteralPath $recordsFile) { [string[]]@([System.IO.File]::ReadAllLines($recordsFile, $utf8)) } else { @() }
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    return @{ Lines = $lines; Code = $rc }
}

function Write-ReportHead($A) {
    if ($A.Tree) { Write-Output "candidate: tree=$($A.Tree) commit=$($A.Commit)" } else { Write-Output 'candidate: unknown' }
    if (Test-GateSame $A.Scope 'owners') { Write-Output "scope: owners $($A.Owners)" } elseif ($A.Scope) { Write-Output "scope: $($A.Scope)" } else { Write-Output 'scope: none' }
    if ($A.Cause.Length -gt 0) { Write-Output "fallback: $($A.Cause)" } else { Write-Output 'fallback: none' }
    Write-ReportLabel 'removed' $A.Removed
    Write-ReportLabel 'omitted' $A.Omitted
}

# Runs the selection, stopping at the first failure. Its pipeline is the run's report.
function Invoke-Selection($A, $Outcome) {
    $count = $A.Runs.Count
    $i = 0
    if ($count -eq 0) { Write-Output 'ran: none' }
    foreach ($run in $A.Runs) {
        $i++
        $shown = ConvertTo-GateAscii $run.Command
        Write-Output "  [$i/$count] $shown"
        $rc = Invoke-GateCommand $run.Command $run.Owners
        $Outcome.Ran.Add("$rc`t$($run.Owners)`t$($run.Command)")
        if (Test-GateSame $run.Owners '-') { Write-Output "ran: $shown (exit $rc)" } else { Write-Output "ran: $shown (owners $($run.Owners); exit $rc)" }
        if ($rc -ne 0) { $Outcome.FailedAt = $i; $Outcome.FailedRc = $rc; return }
    }
}

# FR-013: a failed command stops at 1, whatever else is true. Drift after commands that
# passed is 3, and drift of any kind invalidates the evidence. Omitted commands with
# nothing run, or a tier emptied on the branch, is 4: nothing was checked.
function Stop-Concluded($A, $Outcome, $Records) {
    $count = $A.Runs.Count
    $result = 'passed'; $valid = $true; $code = 0
    if ($Outcome.FailedAt -ne 0) {
        $result = 'failed'; $code = 1
        $line = "the $Tier gate failed at command $($Outcome.FailedAt)/$count (exit $($Outcome.FailedRc))"
    } elseif ($count -eq 0 -and ($A.Omitted.Count + $A.Removed.Count) -gt 0) {
        $result = 'skipped'; $code = 4
        $line = "the $Tier gate ran nothing: every command was omitted or removed, and a skip is not a pass"
    } elseif ($count -eq 0) {
        $result = 'undeclared'
        $line = "no $Tier gate declared, so nothing ran"
    } else {
        $named = if ($A.Scope -and (Test-GateSame $A.Scope 'owners')) { "owners $($A.Owners)" } else { $A.Scope }
        $line = "the $Tier gate passed (scope: $named) - $count command(s) ran, $($A.Omitted.Count) omitted"
    }
    $drift = Get-GateCandidateRefusal $A.Tree
    if ($null -ne $drift) {
        $valid = $false
        if ($code -eq 0) {
            $result = 'invalid'; $code = 3
            $line = "the $Tier gate refused the candidate after running: $drift"
        }
    }
    $where = Write-GateEvidence $Tier $A.Tree ([string[]]@($Records)) ([string[]]@($Outcome.Ran)) $result $valid
    Write-Output "evidence: $(ConvertTo-GateAscii $where)"
    if ($code -eq 0) { Write-Output $line } else { [Console]::Error.WriteLine($line) }
    exit $code
}

# The answer is not `inactive`: refuse it, or run it and report. Exits either way.
function Invoke-SelectedRun($Answer) {
    if ($Answer.Lines.Count -eq 0 -or -not (Test-GateSame $Answer.Lines[-1] 'end')) {
        Stop-Refused "no-selection: gate-impact exit $($Answer.Code)"
    }
    $selection = Read-SelectedRecords $Answer.Lines
    if ($selection.Refused.Length -gt 0) { Stop-Refused $selection.Refused }
    Write-ReportHead $selection
    $outcome = @{ FailedAt = 0; FailedRc = 0; Ran = [System.Collections.Generic.List[string]]::new() }
    Invoke-Selection $selection $outcome
    Stop-Concluded $selection $outcome $Answer.Lines
}
