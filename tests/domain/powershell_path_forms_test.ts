import { assertEquals } from "@std/assert";
import { commandPaths } from "../../src/domain/command_targets.ts";
import { buildsPathUnread } from "../../src/domain/powershell_path.ts";

/**
 * The ways of setting PowerShell's PATH that no reading of a value gives whole: a spelling only the
 * text as PowerShell reads it shows, a drive or provider reference to the environment, an
 * assignment of another shape, and the primitives that build code or a member's name at run time.
 * Each names its source as not fully read, through the hook the harness runs.
 */

const none = (_path: string) => false;
const hook = (command: string) =>
  new TextEncoder().encode(
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command }] }] } }),
  );
const whole = (command: string) => commandPaths(".claude/settings.json", hook(command), none).whole;
const unread = (commands: readonly string[]) => commands.filter(whole);

Deno.test("a PATH spelled through an escape, a comment or a line's join is not read whole", () => {
  assertEquals(
    unread([
      "${env:Pat`h} = 'tools'; lint",
      "${env:`Path} += ';tools'",
      "$env:Path <#c#>= 'tools'",
      "$env:Path<#c#>+= ';tools'",
      "$env:Path `\n= (Resolve-Path tools).Path",
      "Write-Output a#b; ${env:Pat`h} = 'tools'",
      "$x = $y#'\nWrite-Output a#b; ${env:Pat`h} = 'tools'",
      "Write-Output a#b; $env:Path <#c#>= 'tools'",
      "Write-Output a#b; $env:Path <#c#>= 'tools'",
      "pwsh -c \"${env:Pat`h} = 'tools'\"",
    ]),
    [],
  );
});

Deno.test("PATH only read, or another variable, leaves the reading whole", () => {
  const read = ["Write-Host $env:Path; lint", "$env:Path += ';tools' # c", "$x = 1 <#c#>; lint"];
  assertEquals(read.filter((c) => !whole(c)), []);
});

Deno.test("an env: drive reference that is not pinned to PATH is not read whole", () => {
  assertEquals(
    unread([
      "gci env: | ? Name -eq Path | si -Value 'tools'",
      "Set-Item env:Pat* 'tools'",
      "Set-Item env:Pat? 'tools'",
      "Set-Item env:[P]ath 'tools'",
      "Set-Location env:; Set-Item Path 'tools'",
      "sl Env:; si Path tools",
      "pushd env:; si Path tools",
      "Rename-Item env:T Path",
      '$n = "Path"; Set-Item "env:$n" tools',
      "${env:\\Path} = 'tools'",
      "${env:/Path} = 'tools'",
    ]),
    [],
  );
});

Deno.test("a drive or provider computed or made at run time is not read whole", () => {
  assertEquals(
    unread([
      "Set-Item ('en'+'v:Path') tools",
      "Set-Item ('e' + 'nv:Path') tools",
      "Set-Item ('env' + ':Path') tools",
      "Set-Item ('en' + 'v:' + 'Path') tools",
      '$d = "env"; Set-Item "$($d):Path" tools',
      "Set-Item Environment::Path tools",
      "Set-Item Microsoft.PowerShell.Core\\Environment::Path tools",
      "New-PSDrive -Name E -PSProvider Environment -Root ''; si E:Path tools",
      "ndr E Environment ''; si E:Path tools",
      "mount E Environment ''; si E:Path tools",
      "$ExecutionContext.SessionState.Drive.New($d, 'global')",
    ]),
    [],
  );
});

Deno.test("PATH in a multiple assignment, or assigned with another operator, is not read whole", () => {
  assertEquals(
    unread(["$env:Path, $x = 'tools', 1", "$env:Path ??= 'tools'", "$env:Path *= 2"]),
    [],
  );
});

Deno.test("code built from text, a computed call or member, or session state is not read whole", () => {
  assertEquals(
    unread([
      "Invoke-Expression $c",
      "iex $c",
      "[scriptblock]::Create($c).Invoke()",
      "$ExecutionContext.InvokeCommand.InvokeScript($c)",
      "$ExecutionContext.InvokeCommand.NewScriptBlock($c)",
      "Invoke-Command -ScriptBlock $b",
      "icm { $c }",
      "& ('Set-' + 'Item') E:Path tools",
      "& 'Set-Item' E:Path tools",
      "Add-Type -TypeDefinition $src",
      "[Environment]::$m('Path', 'tools')",
      "[Environment]::('Set' + 'EnvironmentVariable')('Path', 'tools')",
      "[Environment].GetMethod($m).Invoke($null, @('Path', 'tools'))",
      "[Environment].InvokeMember($m, 'InvokeMethod', $null, $null, @('Path', 'tools'))",
      "$ExecutionContext.SessionState.PSVariable.Set($n, 'tools')",
      "$ExecutionContext.InvokeProvider.Item.Set($p, 'tools')",
      "$r.SessionStateProxy.SetVariable($n, 'tools')",
    ]),
    [],
  );
});

Deno.test("an encoded command beside pwsh or powershell, in any spelling, is not read whole", () => {
  const options = [
    "-EncodedCommand",
    "-e",
    "-ec",
    "-enc",
    "-ENCODEDC",
    "/e",
    "\u2013e",
    "\u2014ec",
  ];
  const spelled = options.map((o) => `pwsh -NoProfile ${o} JABlAG4AdgA=`);
  assertEquals(unread([...spelled, "powershell.exe -e JABlAG4AdgA="]), []);
  const other = ["pwsh -ex Bypass -c lint", "pwsh -ep Bypass -c lint", "grep -e x file"];
  assertEquals(other.filter((c) => !whole(c)), []);
});

Deno.test("a write the next session inherits is not read whole", () => {
  assertEquals(
    unread([
      "setx PATH tools",
      "Set-ItemProperty HKCU:\\Environment -Name Path -Value tools",
      "sp 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment' Path tools",
      "reg add HKCU\\Environment /v Path /d tools /f",
    ]),
    [],
  );
});

Deno.test("a string PowerShell reads otherwise than its words do is not read whole", () => {
  const strings = ["$env:Path = 'to''ols'", '$env:Path = "tool`s"', '$env:Path = "to""ols"'];
  assertEquals(unread(strings), []);
  assertEquals(strings.filter((s) => !buildsPathUnread(s)), []);
});

Deno.test("each form names its source alone, no other form matching it", () => {
  assertEquals(
    unread([
      "Set-Location Environment::; si Path tools",
      'Set-Item "$($d):Path" tools',
      "Set-Item \"env$(':')Path\" tools",
      "New-PSDrive -Name E -PSProvider Environment -Root ''",
      "ndr E Environment ''",
      "mount E Environment ''",
      "$s.Drive.New($d, 'global')",
      "& ('Get-' + 'Date')",
      "[Environment]::$m($n, $v)",
      "[Environment]::('Set' + 'X')($n, $v)",
      "[Environment].GetMethod($m).Invoke($null, $a)",
      "$t.InvokeMember($m, 'InvokeMethod', $null, $null, $a)",
      "[Environment]::SetEnvironmentVariable($n, $v)",
    ]),
    [],
  );
});

Deno.test("a list left as a list, or joined and then added to, is not read whole", () => {
  assertEquals(
    unread(["$env:Path = 'tools', 'bin'", "$env:Path = @('a', 'b') -join ';' + 'x'"]),
    [],
  );
});

Deno.test("a PATH only the text as PowerShell reads it spells is not read whole, even read alone", () => {
  assertEquals(unread(["Write-Host ${env:Pat`h}"]), []);
});
