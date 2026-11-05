# Dot-sourced by gate-impact.ps1. PowerShell twin of _gate_impact_read.sh, and the one
# reader of `.specnaut/impact.json` and of an adapter's output. System.Text.Json is
# strict where ConvertFrom-Json is not: it refuses comments and trailing commas, and
# leaves a string that looks like a date a string, so both twins refuse the same files.
#
# A function here reports what is wrong; whether that widens the run is gate-impact's
# call, not this file's. Every catch below turns a parse failure into that named
# report, which is how it reaches the run's `fallback:` line.

$script:GateOwnerId = '\A[A-Za-z0-9][A-Za-z0-9._-]{0,63}\z'
$script:GateBadPath = '\A/|\\|[*?\[\]{}]|[\x00-\x1f\x7f]|\.\.|//|\./|\A\.\z|/\.\z'

function Get-JsonProperty($Element, [string]$Name) {
    $out = [System.Text.Json.JsonElement]::new()
    if ($Element.ValueKind -eq 'Object' -and $Element.TryGetProperty($Name, [ref]$out)) { return $out }
    return $null
}
function Test-JsonKind($Value, [string]$Kind) { return ($null -ne $Value -and (Test-GateSame "$($Value.ValueKind)" $Kind)) }
function Test-OwnerId($Value) { return ((Test-JsonKind $Value 'String') -and $Value.GetString() -cmatch $script:GateOwnerId) }
function Test-Clean($Value) {
    if (-not (Test-JsonKind $Value 'String')) { return $false }
    $text = $Value.GetString()
    return ($text.Length -gt 0 -and $text -cnotmatch '[\x00-\x1f\x7f]')
}
function Test-PathOk($Value) {
    if (-not (Test-JsonKind $Value 'String')) { return $false }
    $text = $Value.GetString()
    return ($text.Length -gt 0 -and $text -cnotmatch $script:GateBadPath)
}
function Test-Every($Value, [scriptblock]$Predicate) {
    if (-not (Test-JsonKind $Value 'Array')) { return $false }
    foreach ($item in $Value.EnumerateArray()) { if (-not (& $Predicate $item)) { return $false } }
    return $true
}
function Test-PathsOk($Value) { return (Test-Every $Value { param($i) Test-PathOk $i }) }
function Test-IdsOk($Value) { return (Test-Every $Value { param($i) Test-OwnerId $i }) }
function Get-JsonStrings($Value) {
    $out = [System.Collections.Generic.List[string]]::new()
    if ($null -ne $Value) { foreach ($item in $Value.EnumerateArray()) { $out.Add($item.GetString()) } }
    return , $out
}
# A JSON array's strings, each once, in ordinal order. A pipeline would see the list as one
# object, and Sort-Object would merge strings that differ only by an ignorable character.
function Get-SortedUnique($Value) {
    $set = [System.Collections.Generic.HashSet[string]]::new([string[]](Get-JsonStrings $Value).ToArray(), [StringComparer]::Ordinal)
    $sorted = [string[]]::new($set.Count)
    $set.CopyTo($sorted)
    [Array]::Sort($sorted, [StringComparer]::Ordinal)
    return , $sorted
}
function Test-SchemaOne($Value) { return ((Test-JsonKind $Value 'Number') -and $Value.GetDouble() -eq 1) }
function Read-JsonRoot([string]$File) {
    return [System.Text.Json.JsonDocument]::Parse([System.IO.File]::ReadAllText($File), [System.Text.Json.JsonDocumentOptions]::new()).RootElement
}

function Test-CheckOk($Check) {
    if (-not (Test-JsonKind $Check 'Object')) { return $false }
    if (-not (Test-Clean (Get-JsonProperty $Check 'gate'))) { return $false }
    if (-not (Test-Clean (Get-JsonProperty $Check 'scoped'))) { return $false }
    $owners = Get-JsonProperty $Check 'owners'
    if ($null -eq $owners -or (Test-JsonKind $owners 'Null')) { return $true }
    return ((Test-IdsOk $owners) -and $owners.GetArrayLength() -gt 0)
}

# The first problem with a declaration, or '' when it has none.
function Get-DeclarationProblem($Root) {
    if (-not (Test-JsonKind $Root 'Object')) { return 'not-an-object' }
    if (-not (Test-SchemaOne (Get-JsonProperty $Root 'schema'))) { return 'schema' }
    $adapter = Get-JsonProperty $Root 'adapter'
    if (-not (Test-JsonKind $adapter 'Object') -or -not (Test-Clean (Get-JsonProperty $adapter 'command'))) { return 'adapter.command' }
    $files = Get-JsonProperty $adapter 'files'
    if (-not (Test-PathsOk $files) -or $files.GetArrayLength() -eq 0) { return 'adapter.files' }
    $tiers = Get-JsonProperty $Root 'scoped_tiers'
    if (-not (Test-Every $tiers { param($i) (Test-JsonKind $i 'String') -and ((Test-GateSame $i.GetString() 'fast') -or (Test-GateSame $i.GetString() 'full')) })) { return 'scoped_tiers' }
    if (-not (Test-PathsOk (Get-JsonProperty $Root 'full_on'))) { return 'full_on' }
    if (-not (Test-PathsOk (Get-JsonProperty $Root 'inert'))) { return 'inert' }
    $checks = Get-JsonProperty $Root 'checks'
    if (-not (Test-Every $checks { param($i) Test-CheckOk $i })) { return 'checks' }
    $gates = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($check in $checks.EnumerateArray()) {
        if (-not $gates.Add((Get-JsonProperty $check 'gate').GetString())) { return 'checks.gate-duplicated' }
    }
    return ''
}

# Reads and validates a declaration. Returns @{ Problem } or the normalized form.
function Read-GateDeclaration([string]$File) {
    try { $root = Read-JsonRoot $File } catch { return @{ Problem = 'not-json' } }
    $problem = Get-DeclarationProblem $root
    if ($problem.Length -gt 0) { return @{ Problem = $problem } }
    $adapter = Get-JsonProperty $root 'adapter'
    $checks = [System.Collections.Generic.List[object]]::new()
    foreach ($check in (Get-JsonProperty $root 'checks').EnumerateArray()) {
        $owners = Get-JsonProperty $check 'owners'
        $named = $null -ne $owners -and (Test-JsonKind $owners 'Array')
        $checks.Add(@{
                Gate   = (Get-JsonProperty $check 'gate').GetString()
                Scoped = (Get-JsonProperty $check 'scoped').GetString()
                Owners = if ($named) { Get-JsonStrings $owners } else { $null }
            })
    }
    return @{
        Problem        = ''
        AdapterCommand = (Get-JsonProperty $adapter 'command').GetString()
        AdapterFiles   = Get-JsonStrings (Get-JsonProperty $adapter 'files')
        ScopedTiers    = Get-JsonStrings (Get-JsonProperty $root 'scoped_tiers')
        FullOn         = Get-JsonStrings (Get-JsonProperty $root 'full_on')
        Inert          = Get-JsonStrings (Get-JsonProperty $root 'inert')
        Checks         = $checks
    }
}

# An owner a check names that no snapshot holds, or $null. A check that can never match
# is a declaration out of date with the graph, and would omit its gate on every change.
function Get-GateUnknownOwner($Declared, $Snapshots) {
    foreach ($check in $Declared.Checks) {
        foreach ($owner in @($check.Owners)) {
            if ($null -eq $owner) { continue }
            $known = $false
            foreach ($snapshot in $Snapshots) { if ($snapshot.ContainsKey($owner)) { $known = $true } }
            if (-not $known) { return $owner }
        }
    }
    return $null
}

function Get-SnapshotProblem($Root, [string]$Commit) {
    if (-not (Test-JsonKind $Root 'Object')) { return 'invalid-json' }
    if (-not (Test-SchemaOne (Get-JsonProperty $Root 'schema'))) { return 'schema-mismatch' }
    if (-not (Test-JsonKind (Get-JsonProperty $Root 'complete') 'True')) { return 'incomplete' }
    $echoed = Get-JsonProperty $Root 'commit'
    if (-not (Test-JsonKind $echoed 'String') -or -not (Test-GateSame $echoed.GetString() $Commit)) { return 'commit-mismatch' }
    $owners = Get-JsonProperty $Root 'owners'
    if (-not (Test-Every $owners { param($i) (Test-JsonKind $i 'Object') -and (Test-OwnerId (Get-JsonProperty $i 'id')) })) { return 'invalid-owner' }
    $ids = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($owner in $owners.EnumerateArray()) {
        if (-not $ids.Add((Get-JsonProperty $owner 'id').GetString())) { return 'invalid-owner' }
    }
    foreach ($owner in $owners.EnumerateArray()) {
        if (-not (Test-PathsOk (Get-JsonProperty $owner 'roots'))) { return 'invalid-root' }
    }
    foreach ($owner in $owners.EnumerateArray()) {
        if (-not (Test-IdsOk (Get-JsonProperty $owner 'depends_on'))) { return 'invalid-owner' }
    }
    foreach ($owner in $owners.EnumerateArray()) {
        foreach ($dep in (Get-JsonProperty $owner 'depends_on').EnumerateArray()) {
            if (-not $ids.Contains($dep.GetString())) { return 'dangling-depends-on' }
        }
    }
    return ''
}

# Reads and validates an adapter's output. Returns @{ Problem } or @{ Owners }, a map
# from id to its sorted roots and dependencies, compared as text by the graph.
function Read-GateSnapshot([string]$File, [string]$Commit) {
    try { $root = Read-JsonRoot $File } catch { return @{ Problem = 'invalid-json' } }
    $problem = Get-SnapshotProblem $root $Commit
    if ($problem.Length -gt 0) { return @{ Problem = $problem } }
    $owners = [System.Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
    foreach ($owner in (Get-JsonProperty $root 'owners').EnumerateArray()) {
        $roots = Get-SortedUnique (Get-JsonProperty $owner 'roots')
        $deps = Get-SortedUnique (Get-JsonProperty $owner 'depends_on')
        $owners[(Get-JsonProperty $owner 'id').GetString()] = @{ Roots = $roots; DependsOn = $deps; Record = ($roots -join "`0") + "`u{1}" + ($deps -join "`0") }
    }
    return @{ Problem = ''; Owners = $owners }
}
