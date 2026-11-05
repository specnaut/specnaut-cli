# Dot-sourced by gate-impact.ps1. PowerShell twin of _gate_impact_graph.sh: the one home
# of the change set and of the affected set with its reverse closure. Reports facts;
# whether one widens the run is gate-impact's call. Comparison is ordinal throughout.

# Returns @{ Paths } or @{ Problem }. --no-renames makes a rename its delete plus its add,
# so both of its owners are seen. Problem is the first path whose kind no adapter can
# vouch for: `type-change: <path>`, `gitlink: <path>` or `symlink: <path>`.
function Get-GateChanges([string]$Base, [string]$Commit) {
    $r = Invoke-GateGit @('diff-tree', '-r', '-z', '--raw', '--no-renames', '--ignore-submodules=none', $Base, $Commit)
    if ($r.Code -ne 0) { return @{ Problem = 'diff-failed' } }
    $paths = [System.Collections.Generic.List[string]]::new()
    $parts = $r.Out.Split([char]0)
    for ($i = 0; $i + 1 -lt $parts.Count; $i += 2) {
        $meta = $parts[$i].Split(' ')
        $path = $parts[$i + 1]
        $old = $meta[0].TrimStart(':')
        $new = $meta[1]
        if ($meta[4].StartsWith('T', [StringComparison]::Ordinal)) { return @{ Problem = "type-change: $path" } }
        if ((Test-GateSame $old '160000') -or (Test-GateSame $new '160000')) { return @{ Problem = "gitlink: $path" } }
        if ((Test-GateSame $old '120000') -or (Test-GateSame $new '120000')) { return @{ Problem = "symlink: $path" } }
        $paths.Add($path)
    }
    return @{ Paths = $paths; Problem = '' }
}

# The path's tracked entries as text, for comparing sides. Code 1 when it has none, 2 when
# one is not a regular file. ls-tree finds nothing through a symlink component, so that
# reads as untracked.
function Get-GateProtectedEntries([string]$Commit, [string]$Path) {
    $r = Invoke-GateGit @('ls-tree', '-r', '-z', $Commit, '--', $Path)
    $entries = @($r.Out.Split([char]0) | Where-Object { $_.Length -gt 0 })
    if ($entries.Count -eq 0) { return @{ Code = 1; Text = '' } }
    foreach ($entry in $entries) {
        if (-not ($entry.StartsWith('100644 ', [StringComparison]::Ordinal) -or $entry.StartsWith('100755 ', [StringComparison]::Ordinal))) {
            return @{ Code = 2; Text = '' }
        }
    }
    return @{ Code = 0; Text = ($entries -join "`n") }
}

function Test-GateHolds([string]$Root, [string]$Path) {
    if ($Root.EndsWith('/', [StringComparison]::Ordinal)) { return $Path.StartsWith($Root, [StringComparison]::Ordinal) }
    return (Test-GateSame $Path $Root)
}
function Test-GateListed($List, [string]$Path) {
    foreach ($root in $List) { if (Test-GateHolds $root $Path) { return $true } }
    return $false
}
function Get-GateOwnersOf($Owners, [string]$Path) {
    $out = [System.Collections.Generic.List[string]]::new()
    foreach ($id in $Owners.Keys) {
        if (Test-GateListed $Owners[$id].Roots $Path) { $out.Add($id) }
    }
    return , $out
}

# The first path no snapshot on its own pair's sides owns, or a full_on one. A path must
# be owned on its own pair's sides, or an owner only another base knows would stop it
# being unowned. Returns the cause, or ''.
function Get-GatePathCause($Pairs, $Candidate, $Declared) {
    foreach ($pair in $Pairs) {
        foreach ($path in $pair.Changes) {
            if (Test-GateListed $Declared.FullOn $path) { return "full-on: $path" }
            if (Test-GateListed $Declared.Inert $path) { continue }
            $held = (Get-GateOwnersOf $Candidate $path).Count + (Get-GateOwnersOf $pair.Snapshot $path).Count
            if ($held -eq 0) { return "unowned: $path" }
        }
    }
    return ''
}

# Returns @{ Cause } or @{ Owners }, sorted ordinally. Once owned, a path affects whoever
# holds it in any snapshot, and the closure runs over every edge any snapshot holds,
# because a dependency removed on the branch still explains why the dependent broke.
function Get-GateAffected($Pairs, $Candidate, $Declared) {
    $cause = Get-GatePathCause $Pairs $Candidate $Declared
    if ($cause.Length -gt 0) { return @{ Cause = $cause } }
    $snapshots = @($Candidate) + @($Pairs | ForEach-Object { $_.Snapshot })
    $set = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($pair in $Pairs) {
        foreach ($path in $pair.Changes) {
            if (Test-GateListed $Declared.Inert $path) { continue }
            foreach ($snapshot in $snapshots) {
                foreach ($id in (Get-GateOwnersOf $snapshot $path)) { [void]$set.Add($id) }
            }
        }
        foreach ($id in @($pair.Snapshot.Keys) + @($Candidate.Keys)) {
            $onBoth = $Candidate.ContainsKey($id) -and $pair.Snapshot.ContainsKey($id)
            if (-not $onBoth -or -not (Test-GateSame $Candidate[$id].Record $pair.Snapshot[$id].Record)) { [void]$set.Add($id) }
        }
    }
    do {
        $before = $set.Count
        foreach ($snapshot in $snapshots) {
            foreach ($id in $snapshot.Keys) {
                foreach ($dep in $snapshot[$id].DependsOn) { if ($set.Contains($dep)) { [void]$set.Add($id) } }
            }
        }
    } while ($set.Count -ne $before)
    $sorted = [string[]]@($set)
    [Array]::Sort($sorted, [StringComparer]::Ordinal)
    return @{ Cause = ''; Owners = $sorted }
}
