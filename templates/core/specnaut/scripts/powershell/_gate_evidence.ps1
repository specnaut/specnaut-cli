# Dot-sourced by run-gate.ps1. PowerShell twin of _gate_evidence.sh, and the one writer of
# gate evidence: what ran on which tree, what was omitted and why, and what was taken on
# trust. It is write-only. Nothing reads it to decide anything: a stale file must never be
# able to skip a check, and a pass is only ever what this run saw.

function Get-GateEvidenceObject([string]$Tier, [string]$Tree, [string[]]$Records, [string[]]$Ran, [string]$Result, [bool]$Valid) {
    # Three fields suit `run` and `omit`. A one-value record is read with rest(): its value may hold a tab.
    $rows = @($Records | ForEach-Object { , @($_.Split("`t", 3)) })
    $rest = { param($kind) @($Records | ForEach-Object { , @($_.Split("`t", 2)) } | Where-Object { Test-GateSame $_[0] $kind } | ForEach-Object { $_[1] }) }
    $of = { param($kind) @($rows | Where-Object { Test-GateSame $_[0] $kind }) }
    $candidate = @(& $of 'candidate')[0]
    $scope = @(& $of 'scope')[0]
    $ownersOf = { param($text) if (Test-GateSame $text '-') { , @() } else { , @($text.Split(' ')) } }
    return [ordered]@{
        schema   = 1
        tier     = $Tier
        tree     = $Tree
        commit   = $candidate[2]
        result   = $Result
        valid    = $Valid
        bases    = @(& $of 'base' | ForEach-Object { $_[1] })
        scope    = $scope[1]
        owners   = & $ownersOf $scope[2]
        fallback = @(& $rest 'fallback')
        removed  = @(& $rest 'removed')
        ran      = @($Ran | ForEach-Object {
                $parts = $_.Split("`t", 3)
                [ordered]@{ exit = [int]$parts[0]; owners = & $ownersOf $parts[1]; command = $parts[2] }
            })
        omitted  = @(& $of 'omit' | ForEach-Object { [ordered]@{ reason = $_[1]; command = $_[2] } })
        trusted  = [ordered]@{
            adapter = @(& $rest 'adapter')[0]
            scoped  = @(& $of 'run' | Where-Object { -not (Test-GateSame $_[1] '-') } | ForEach-Object { $_[2] })
        }
    }
}

# Writes the file atomically and returns its path, or `unwritten (<cause>)`. Failing to
# record a result does not change the result, so every failure here is that report.
function Write-GateEvidence([string]$Tier, [string]$Tree, [string[]]$Records, [string[]]$Ran, [string]$Result, [bool]$Valid) {
    $path = Get-GateGitValue @('rev-parse', '--git-path', "specnaut/gate-evidence/$Tier-$Tree.json")
    if ($null -eq $path) { return 'unwritten (no-git-path)' }
    if (-not [System.IO.Path]::IsPathRooted($path)) { $path = Join-Path $repoRoot $path }
    $dir = Split-Path -Parent $path
    try {
        [void][System.IO.Directory]::CreateDirectory($dir)
    } catch {
        return 'unwritten (cannot-create-directory)'
    }
    $tmp = Join-Path $dir ".evidence.$([guid]::NewGuid().ToString('N'))"
    try {
        $json = Get-GateEvidenceObject $Tier $Tree $Records $Ran $Result $Valid | ConvertTo-Json -Depth 6
        [System.IO.File]::WriteAllText($tmp, "$json`n", [System.Text.UTF8Encoding]::new($false))
        [System.IO.File]::Move($tmp, $path, $true)
    } catch {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
        return 'unwritten (cannot-write-file)'
    }
    return $path
}
