using namespace System.Management.Automation.Language
# What PowerShell's own parser says each corpus line does to PATH, for the differential test of the
# instruction check's reader (tests/domain/powershell_path_differential_test.ts). Nothing is run:
# each line, and each variant of it at each token (a comment, a line's join, a backtick, a case
# flip), is parsed and its PATH writes collected from the syntax tree, with the names, paths and
# aliases PowerShell resolves. One JSON record per line: its text, its parse errors, its number of
# PATH writes, and the folders they put on PATH when every one is built of constants, else null.
param([Parameter(Mandatory)] [string] $CorpusPath)
Set-StrictMode -Version 3
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot writes.ps1)

function Get-Record([string] $text, [bool] $base) {
    $t = $null; $e = $null
    $ast = [Parser]::ParseInput($text, [ref]$t, [ref]$e)
    $writes = [System.Collections.Generic.List[object]]::new()
    if ($e.Count -eq 0) { $writes = Get-Writes $ast 0 }
    $folders = $null
    if (-not $writes.Contains($null)) { $folders = @($writes | ForEach-Object { $_ }) }
    $record = @{ text = $text; base = $base; errors = $e.Count; writes = $writes.Count; folders = $folders }
    return [pscustomobject]$record
}

$Escapes = '0abefnrtuv'
function Get-Variants([string] $line) {
    $t = $null; $e = $null
    $null = [Parser]::ParseInput($line, [ref]$t, [ref]$e)
    foreach ($token in $t | Where-Object { $_.Kind -notin 'EndOfInput', 'NewLine' }) {
        $at, $end = $token.Extent.StartOffset, $token.Extent.EndOffset
        $line.Insert($at, '<#c#>')
        $line.Insert($at, '`' + "`n")
        $last = $line[$end - 1]
        $escaped = $Escapes.Contains($last)
        if ($end - $at -ge 2 -and [char]::IsLetter($last) -and -not $escaped) { $line.Insert($end - 1, '`') }
        $flipped = -join ($token.Text.ToCharArray() | ForEach-Object {
                if ([char]::IsUpper($_)) { [char]::ToLower($_) } else { [char]::ToUpper($_) } })
        $line.Substring(0, $at) + $flipped + $line.Substring($end)
    }
}

$records = foreach ($line in [IO.File]::ReadAllLines($CorpusPath)) {
    if ($line.Trim() -eq '') { continue }
    Get-Record $line $true
    foreach ($variant in Get-Variants $line | Select-Object -Unique) { Get-Record $variant $false }
}
ConvertTo-Json -InputObject @($records) -Depth 4 -Compress
