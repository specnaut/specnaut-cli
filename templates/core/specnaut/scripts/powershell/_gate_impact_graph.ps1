# Dot-sourced by gate-impact.ps1. PowerShell twin of _gate_impact_graph.sh: the one home
# of the change set and of the affected set with its reverse closure. Reports facts;
# whether one widens the run is gate-impact's call. Comparison is ordinal throughout, on
# ASCII-folded text where a match only adds an owner (Test-GateHolds, Get-GateAffectedBy).
#
# Every path is top-relative: gate-impact refuses a project not at its work tree's top
# (Test-GateCandidateInRepo), so a declared path already is one; trees are listed whole
# (--full-tree). git's output is decoded leniently (Invoke-GateProcess): bytes that are not
# UTF-8 read as U+FFFD, as the bash twin's jq decodes them. A path holding U+FFFD or a
# newline is never compared: a changed one widens as `path-unreadable`, a protected one
# reads as not regular. The same rule in both twins, so they never answer apart on such a name.

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
# one is not a regular file or its name holds a newline or U+FFFD: the text is
# newline-joined, so a newline could read as two entries, and two names that are not UTF-8
# can decode alike. ls-tree finds nothing through a symlink component, so that reads as untracked.
function Get-GateProtectedEntries([string]$Commit, [string]$Path) {
    $r = Invoke-GateGit @('ls-tree', '-r', '-z', '--full-tree', $Commit, '--', $Path)
    $entries = @($r.Out.Split([char]0) | Where-Object { $_.Length -gt 0 })
    if ($entries.Count -eq 0) { return @{ Code = 1; Text = '' } }
    foreach ($entry in $entries) {
        if ($entry.Contains("`n") -or $entry.Contains([char]0xFFFD)) { return @{ Code = 2; Text = '' } }
        if (-not ($entry.StartsWith('100644 ', [StringComparison]::Ordinal) -or $entry.StartsWith('100755 ', [StringComparison]::Ordinal))) {
            return @{ Code = 2; Text = '' }
        }
    }
    return @{ Code = 0; Text = ($entries -join "`n") }
}

# Folding only ever widens the run. A path meets a root in any ASCII case where that adds an owner,
# both sides folded: a case-insensitive file system hands git `apps/WEB/.gitattributes` for a file in
# `apps/web/`. Where a match narrows it, clearing `unowned`, skipping `inert` or sparing a nested
# .gitattributes as spanned, it is exact (-Exact). The bash twin's holds and meets.
function Test-GateHolds([string]$Root, [string]$Path, [switch]$Exact) {
    $r = if ($Exact) { $Root } else { Get-GateAsciiLower $Root }
    $p = if ($Exact) { $Path } else { Get-GateAsciiLower $Path }
    if ($r.EndsWith('/', [StringComparison]::Ordinal)) { return $p.StartsWith($r, [StringComparison]::Ordinal) }
    return (Test-GateSame $p $r)
}
function Test-GateListed($List, [string]$Path, [switch]$Exact) {
    foreach ($root in $List) { if (Test-GateHolds $root $Path -Exact:$Exact) { return $true } }
    return $false
}
function Get-GateOwnersOf($Owners, [string]$Path, [switch]$Exact) {
    $out = [System.Collections.Generic.List[string]]::new()
    foreach ($id in $Owners.Keys) {
        if (Test-GateListed $Owners[$id].Roots $Path -Exact:$Exact) { $out.Add($id) }
    }
    return , $out
}

# A root file that changes how every other path is checked out or fetched, whatever the
# declaration calls it. ASCII case folds, as a case-insensitive file system hands git
# `.GitAttributes` for `.gitattributes`, and only ASCII, as the bash twin's jq folds: no .NET
# casing. The bash twin's checkout_config holds the same list.
function Test-GateCheckoutConfig([string]$Path) {
    $folded = Get-GateAsciiLower $Path
    foreach ($name in @('.gitattributes', '.lfsconfig', '.gitmodules')) { if (Test-GateSame $folded $name) { return $true } }
    return $false
}
# A path another fold, a normalisation or HFS+ could read as one the graph matches is never
# compared (the bash twin's unreadable): one holding a newline or a code point above U+007F
# anywhere, U+FFFD among them (U+017F folds to s, HFS+ ignores U+200C, NFD spells é in two), or a
# name holding `~` and a digit, as an 8.3 short name does. A declared root holding either is refused.
function Test-GateUnreadable([string]$Path) {
    if ($Path.Contains("`n")) { return $true }
    for ($i = 0; $i -lt $Path.Length; $i++) {
        if ([int]$Path[$i] -gt 127) { return $true }
        $next = $i + 1 -lt $Path.Length -and [int]$Path[$i + 1] -ge 48 -and [int]$Path[$i + 1] -le 57
        if ($Path[$i] -eq [char]'~' -and $next) { return $true }
    }
    return $false
}
function Get-GateAsciiLower([string]$Text) {
    $chars = $Text.ToCharArray()
    for ($i = 0; $i -lt $chars.Length; $i++) {
        if ([int]$chars[$i] -ge 65 -and [int]$chars[$i] -le 90) { $chars[$i] = [char]([int]$chars[$i] + 32) }
    }
    return -join $chars
}

# A nested .gitattributes in folder D changes how every path below D is checked out, so it
# affects, past the owners holding it, every owner with a root below D/, roots being free to
# nest. Only a folder root that holds it holds every path below D (Test-GateSpanned); held by
# file roots alone, it widens as checkout config. The bash twin's affected_by and spanned.
function Test-GateNestedAttributes([string]$Path) {
    return (Get-GateAsciiLower $Path).EndsWith('/.gitattributes', [StringComparison]::Ordinal)
}
function Test-GateSpanned($Owners, [string]$Path) {
    foreach ($id in $Owners.Keys) {
        foreach ($root in $Owners[$id].Roots) {
            if ($root.EndsWith('/', [StringComparison]::Ordinal) -and $Path.StartsWith($root, [StringComparison]::Ordinal)) { return $true }
        }
    }
    return $false
}
function Get-GateAffectedBy($Owners, [string]$Path) {
    $out = Get-GateOwnersOf $Owners $Path
    if (-not (Test-GateNestedAttributes $Path)) { return , $out }
    $folder = Get-GateAsciiLower ($Path.Substring(0, $Path.Length - '.gitattributes'.Length))
    foreach ($id in $Owners.Keys) {
        foreach ($root in $Owners[$id].Roots) {
            if ((Get-GateAsciiLower $root).StartsWith($folder, [StringComparison]::Ordinal)) { $out.Add($id); break }
        }
    }
    return , $out
}

# The first path that cannot be compared, a checkout-config one, a full_on one, one no
# snapshot on its own pair's sides owns, or a nested .gitattributes no folder root holds. A
# path must be owned on its own pair's sides, or an owner only another base knows would stop
# it being unowned. Returns the cause, or ''.
function Get-GatePathCause($Pairs, $Candidate, $Declared) {
    foreach ($pair in $Pairs) {
        foreach ($path in $pair.Changes) {
            if (Test-GateUnreadable $path) { return "path-unreadable: $path" }
            if (Test-GateCheckoutConfig $path) { return "checkout-config: $path" }
            if (Test-GateListed $Declared.FullOn $path) { return "full-on: $path" }
            if (Test-GateListed $Declared.Inert $path -Exact) { continue }
            $held = (Get-GateOwnersOf $Candidate $path -Exact).Count + (Get-GateOwnersOf $pair.Snapshot $path -Exact).Count
            if ($held -eq 0) { return "unowned: $path" }
            $spanned = (Test-GateSpanned $Candidate $path) -or (Test-GateSpanned $pair.Snapshot $path)
            if ((Test-GateNestedAttributes $path) -and -not $spanned) { return "checkout-config: $path" }
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
            if (Test-GateListed $Declared.Inert $path -Exact) { continue }
            foreach ($snapshot in $snapshots) {
                foreach ($id in (Get-GateAffectedBy $snapshot $path)) { [void]$set.Add($id) }
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
