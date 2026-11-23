using namespace System.Management.Automation.Language
# The PATH writes of a parsed PowerShell text, as its syntax tree and PowerShell's own resolution of
# names, paths and aliases say (oracle.ps1). Each write is the folders it puts on PATH when it is
# built of constants, else $null. Dot-sourced by oracle.ps1; runs nothing it reads.
Set-StrictMode -Version 3

$Sentinel = [string][char]0 + 'PATH' + [char]0
$WriteVerbs = 'Set', 'New', 'Add', 'Clear', 'Remove', 'Rename', 'Move', 'Copy', 'Push'

function Test-PathVariable($e) {
    if ($e -isnot [VariableExpressionAst] -or $e.VariablePath.DriveName -ne 'env') { return $false }
    return ($e.VariablePath.UserPath -replace '^env:[\\/]?', '') -eq 'Path'
}

# The value of a constant expression, $env:Path read as the sentinel; throws on any other.
function Get-Constant($e) {
    if ($e -is [StringConstantExpressionAst]) { return , $e.Value }
    if (Test-PathVariable $e) { return , $Sentinel }
    if ($e -is [ExpandableStringExpressionAst]) {
        $text = $e.Value
        foreach ($n in $e.NestedExpressions) {
            if (-not (Test-PathVariable $n)) { throw 'not constant' }
            $text = $text.Replace($n.Extent.Text, $Sentinel)
        }
        return , $text
    }
    if ($e -is [ParenExpressionAst]) { $value = Get-Statement $e.Pipeline; return , $value }
    if ($e -is [ArrayExpressionAst] -and $e.SubExpression.Statements.Count -eq 1) {
        $value = Get-Statement $e.SubExpression.Statements[0]
        return , @($value)
    }
    if ($e -is [ArrayLiteralAst]) { return , @($e.Elements | ForEach-Object { Get-Constant $_ }) }
    if ($e -is [BinaryExpressionAst] -and $e.Operator -eq 'Plus') {
        $l, $r = (Get-Constant $e.Left), (Get-Constant $e.Right)
        if ($l -is [array] -or $r -is [array]) { throw 'not constant' }
        return , ($l + $r)
    }
    if ($e -is [BinaryExpressionAst] -and $e.Operator -eq 'Join') {
        return , ((Get-Constant $e.Left) -join (Get-Constant $e.Right))
    }
    throw 'not constant'
}

function Get-Statement($s) {
    if ($s -is [PipelineAst] -and $s.PipelineElements.Count -eq 1) { $s = $s.PipelineElements[0] }
    if ($s -is [CommandExpressionAst]) { return , (Get-Constant $s.Expression) }
    throw 'not constant'
}

# The folders a value puts on PATH: an array is one string, its items joined by blanks.
function Get-Folders($value) {
    $text = if ($value -is [array]) { $value -join ' ' } else { [string]$value }
    return , @($text -split '[;:]' | Where-Object { $_ -ne '' -and $_ -ne $Sentinel })
}

# Whether a constant argument names an item of the Environment provider, or the registry's.
function Test-EnvironmentPath([string] $path) {
    if ($path -match '(?i)^(hk\w+:|registry::|hkey_).*[\\/]environment$') { return $true }
    $provider = $null; $drive = $null; $paths = $ExecutionContext.SessionState.Path
    # A path on no drive PowerShell knows names no item of any provider.
    try { $null = $paths.GetUnresolvedProviderPathFromPSPath($path, [ref]$provider, [ref]$drive) }
    catch [System.Management.Automation.MethodInvocationException] { return $false }
    return $provider.Name -eq 'Environment'
}

function Resolve-Name([string] $name, $aliases) {
    if ($aliases.ContainsKey($name)) { $name = $aliases[$name] }
    $c = Get-Command -Name ([WildcardPattern]::Escape($name)) -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($c -is [System.Management.Automation.AliasInfo]) { $c = $c.ResolvedCommand }
    return $c
}

# Each PATH write of a parsed text: a folder list when built of constants, else $null.
function Get-Writes($ast, [int] $depth) {
    $writes = [System.Collections.Generic.List[object]]::new()
    $aliases = @{}
    foreach ($c in $ast.FindAll({ $args[0] -is [CommandAst] }, $true)) {
        $named = @($c.CommandElements | Where-Object { $_ -is [StringConstantExpressionAst] })
        if ($named.Count -ge 3 -and $named[0].Value -match '^(set-alias|new-alias|sal|nal)$') {
            $aliases[$named[1].Value] = $named[2].Value
        }
    }
    foreach ($a in $ast.FindAll({ $args[0] -is [AssignmentStatementAst] }, $true)) {
        $left = if ($a.Left -is [ConvertExpressionAst]) { $a.Left.Child } else { $a.Left }
        $targets = @($left)
        if ($left -is [ArrayLiteralAst]) { $targets = @($left.Elements) }
        if (-not ($targets | Where-Object { Test-PathVariable $_ })) { continue }
        $folders = $null
        if ($targets.Count -eq 1 -and $a.Operator -in 'Equals', 'PlusEquals') {
            # A value built of anything but constants throws: its folders are not known.
            try {
                $value = Get-Statement $a.Right
                if ($a.Operator -eq 'PlusEquals') { $value = $Sentinel + [string]$value }
                $folders = Get-Folders $value
            } catch [System.Management.Automation.RuntimeException] { $folders = $null }
        }
        $writes.Add($folders)
    }
    foreach ($c in $ast.FindAll({ $args[0] -is [CommandAst] }, $true)) {
        Add-CommandWrites $c $aliases $depth $writes
    }
    foreach ($m in $ast.FindAll({ $args[0] -is [InvokeMemberExpressionAst] }, $true)) {
        Add-MemberWrites $m $depth $writes
    }
    return , $writes
}

function Add-CodeWrites([string] $code, [int] $depth, $writes) {
    if ($depth -gt 3) { $writes.Add($null); return }
    $t = $null; $e = $null
    $inner = [Parser]::ParseInput($code, [ref]$t, [ref]$e)
    foreach ($w in (Get-Writes $inner ($depth + 1))) { $writes.Add($w) }
}

function Add-CommandWrites($c, $aliases, [int] $depth, $writes) {
    $name = $c.GetCommandName()
    if ($null -eq $name) {
        if ($c.CommandElements[0] -isnot [ScriptBlockExpressionAst]) { $writes.Add($null) }
        return
    }
    $elements = @($c.CommandElements | Select-Object -Skip 1)
    $constants = @($elements | Where-Object { $_ -is [StringConstantExpressionAst] } |
        ForEach-Object Value)
    $info = Resolve-Name $name $aliases
    $resolved = if ($info) { $info.Name } else { $name }
    if ($resolved -match '^(pwsh|powershell)(\.exe)?$') { return Add-ShellWrites $elements $depth $writes }
    $registry = $constants | Where-Object { $_ -match '(?i)[\\/]environment$' }
    $persists = ($resolved -match '^setx(\.exe)?$' -and $constants -contains 'PATH') -or
        ($resolved -match '^reg(\.exe)?$' -and $registry)
    if ($persists -or $resolved -in 'Add-Type', 'New-PSDrive') { return $writes.Add($null) }
    if ($resolved -in 'Invoke-Expression', 'Invoke-Command') {
        if ($constants.Count -eq 0 -or $constants.Count -ne $elements.Count) { return $writes.Add($null) }
        foreach ($s in $constants) { Add-CodeWrites $s $depth $writes }
        return
    }
    $bound = $c.CommandElements | Where-Object { $_ -is [CommandParameterAst] -and
        $_.Argument -is [StringConstantExpressionAst] } | ForEach-Object { $_.Argument.Value }
    foreach ($s in @($constants) + @($bound)) { if (Test-EnvironmentPath $s) { return $writes.Add($null) } }
    $core = $info -and $info.CommandType -eq 'Cmdlet' -and
        [Microsoft.PowerShell.Commands.CoreCommandBase].IsAssignableFrom($info.ImplementingType)
    $built = $elements | Where-Object {
        $_ -isnot [StringConstantExpressionAst] -and $_ -isnot [CommandParameterAst] }
    $piped = $c.Parent.PipelineElements.IndexOf($c) -gt 0
    if ($core -and $info.Verb -in $WriteVerbs -and ($built -or $piped)) { $writes.Add($null) }
}

function Add-ShellWrites($elements, [int] $depth, $writes) {
    for ($i = 0; $i -lt $elements.Count - 1; $i++) {
        $option = [string]$elements[$i].Extent.Text -replace '^[-/\u2013\u2014\u2015]', ''
        $next = $elements[$i + 1]
        if ($next -isnot [StringConstantExpressionAst]) { continue }
        if ($option -eq '') { continue }
        if ('command'.StartsWith($option, 'OrdinalIgnoreCase')) { Add-CodeWrites $next.Value $depth $writes }
        if ($option -eq 'ec' -or 'encodedcommand'.StartsWith($option, 'OrdinalIgnoreCase')) {
            $bytes = [Convert]::FromBase64String($next.Value)
            Add-CodeWrites ([Text.Encoding]::Unicode.GetString($bytes)) $depth $writes
        }
    }
}

$CodeMembers = 'Create', 'InvokeScript', 'NewScriptBlock'
$Reflection = 'SetEnvironmentVariable', 'GetMethod', 'GetMethods', 'InvokeMember', 'SetVariable'

function Add-MemberWrites($m, [int] $depth, $writes) {
    if ($m.Member -isnot [StringConstantExpressionAst]) { $writes.Add($null); return }
    $member = $m.Member.Value
    $target = $m.Expression.Extent.Text
    $code = @($m.Arguments | Where-Object { $_ -is [StringConstantExpressionAst] })
    if ($member -in $CodeMembers) {
        if ($code.Count -eq 0 -or $code.Count -ne @($m.Arguments).Count) { return $writes.Add($null) }
        foreach ($s in $code) { Add-CodeWrites $s.Value $depth $writes }
        return
    }
    if ($member -in $Reflection -or $target -match '(?i)executioncontext|sessionstate') { $writes.Add($null) }
}

