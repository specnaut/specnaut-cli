$env:Path += ';tools'
$env:Path = 'tools;' + $env:Path
${env:Path} = "tools;${env:Path}"
$env:PATH = @('tools', $env:Path) -join ';'
$env:Path = 'tools', $env:Path -join ';'
$env:Path += ';' + 'tools'
$env:Path = 'tools'
$env:Path = 'tools', 'bin'
$env:Path = @('tools', 'bin') -join ';' + 'x'
$env:Path = "tool`s;$env:Path"
$env:Path = 'to''ols'
$env:Path = (Resolve-Path tools).Path
$env:Path = "$(Resolve-Path tools);$env:Path"
$t = 'tools'; $env:Path = "$t;$env:Path"
$env:Path = 'tXols' -replace 'X', 'o'
$env:Path, $x = 'tools', 1
$env:Path ??= 'tools'
${env:\Path} = 'tools'
Set-Item -Path env:Path -Value 'tools'
si env:\Path 'tools'
New-Item -Path Env:PATH -Value tools -Force
Set-Content -Path:env:Path tools
gci env: | ? Name -eq Path | si -Value 'tools'
Set-Item env:Pat* 'tools'
Set-Location env:; Set-Item Path 'tools'
Rename-Item env:T Path
$n = 'Path'; Set-Item "env:$n" tools
Set-Item ('en' + 'v:Path') tools
$d = 'env'; Set-Item "$($d):Path" tools
Set-Item Environment::Path tools
Set-Alias q Set-Item; q env:Path tools
New-PSDrive -Name E -PSProvider Environment -Root ''; Set-Item E:Path tools
[Environment]::SetEnvironmentVariable('Path', 'tools', 'Process')
[Environment]::$m('Path', 'tools')
Invoke-Expression $c
iex '$env:Path += ";tools"'
[scriptblock]::Create('$env:Path = "tools"').Invoke()
& ('Set-' + 'Item') E:Path tools
$ExecutionContext.InvokeCommand.InvokeScript('$env:Path = "tools"')
Add-Type -TypeDefinition $src
pwsh -NoProfile -Command '$env:Path += '';tools''; lint'
pwsh -NoProfile -EncodedCommand JABlAG4AdgA6AFAAYQB0AGgAIAArAD0AIAAnADsAdABvAG8AbABzACcA
setx PATH tools
Set-ItemProperty HKCU:\Environment -Name Path -Value tools
reg add HKCU\Environment /v Path /d tools /f
Write-Host $env:Path
$env:PathExt += ';.X'
lint --fix
