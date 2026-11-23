import { assertEquals } from "@std/assert";
import { commandPaths } from "../../src/domain/command_targets.ts";
import { onPathTargets } from "../../src/domain/command_search_path.ts";
import { pathIndex } from "../../src/domain/path_index.ts";

/**
 * PowerShell's PATH, `$env:Path` or `${env:Path}`, in any letter case: every word after it in its
 * command is read as a value it may be set to, when the value is built only of quoted strings and
 * PATH joined at a `;`. A value built any other way (a bracket, a command, a pipeline, parts joined
 * elsewhere than at a `;`), or PATH set through the `env:` drive or .NET, is not read: its source
 * is named as not fully read.
 */

const enc = (s: string) => new TextEncoder().encode(s);
const none = (_path: string) => false;
const span = (command: string) =>
  commandPaths(".claude/commands/c.md", enc(`Run !\`${command}\`\n`), none);
const hook = (command: string) =>
  enc(JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command }] }] } }));
const HELD = pathIndex([{ path: "tools/lint.ps1", kind: "blob" }]);

/** The files a command runs from the folders it puts on PATH, in a tree holding `tools/lint.ps1`. */
function targets(found: ReturnType<typeof span>): string[] {
  const on = { folders: found.onPath, programs: found.programs };
  return onPathTargets(on, [HELD], { whole: true });
}

Deno.test("each spelling of a PowerShell PATH set or appended to puts `tools` on PATH", () => {
  const spellings = [
    "$env:Path = $env:Path + ';tools'; lint",
    "$env:Path += ';' + 'tools'; lint",
    "$env:Path +=';tools'; lint",
    "${env:Path} += ';tools'; lint",
    "$env:path += ';tools'; lint",
  ];
  for (const command of spellings) {
    const found = span(command);
    assertEquals([targets(found), found.whole], [["tools/lint.ps1"], true], command);
  }
});

Deno.test("a hook's PowerShell PATH is read, and a raw line's when the parse fails", () => {
  const settings = (bytes: Uint8Array) => commandPaths(".claude/settings.json", bytes, none);
  assertEquals(targets(settings(hook("$env:Path += ';tools'; lint"))), ["tools/lint.ps1"]);
  for (const name of ["$env:Path", "${env:Path}"]) {
    assertEquals(settings(enc(`{"x": "${name} += ';tools'; lint", `)).onPath, ["tools"], name);
  }
});

Deno.test("the operator is taken off the value, glued to it or not: no folder `+=` is read", () => {
  for (const command of ["$env:Path +=';tools'", "$env:Path += ';tools'", "$env:Path= 'tools'"]) {
    assertEquals(span(command).onPath, ["tools"], command);
  }
});

Deno.test("a PowerShell PATH folder holding a variable past its start is not read whole", () => {
  assertEquals(span("$env:path += ';x/$D/bin'; lint").whole, false);
});

Deno.test("PATH set through the env: drive or .NET names its source as not fully read", () => {
  const unread = [
    "Set-Item -Path env:Path -Value 'tools'; lint",
    "si env:\\Path 'tools'; lint",
    "New-Item -Path Env:PATH -Value tools -Force; lint",
    "ni env:/Path tools; lint",
    "Set-Content -Path:env:Path tools; lint",
    "[Environment]::SetEnvironmentVariable('Path', 'tools', 'Process'); lint",
    "[System.Environment]::setenvironmentvariable('PATH', 'tools'); lint",
  ];
  for (const command of unread) assertEquals(span(command).whole, false, command);
});

Deno.test("a variable only named like PATH, or PATH only read, leaves the reading whole", () => {
  for (const command of ["$env:PathExt += ';.X'; lint", "Write-Host $env:Path; lint"]) {
    const found = span(command);
    assertEquals([found.onPath, found.whole], [[], true], command);
  }
});

Deno.test("PowerShell's PATH inside a value is the PATH in effect, braced or not", () => {
  for (const command of ['$env:Path = "tools;$env:Path"', '$env:Path = "tools;${env:Path}"']) {
    assertEquals(span(command).onPath, ["tools"], command);
  }
});

Deno.test("a PowerShell PATH value built by a bracket, a `$(…)` or a command is not read whole", () => {
  const unread = [
    "$env:Path = (Resolve-Path tools).Path; lint",
    "$env:Path = ('tools;' + $env:Path); lint",
    "$env:Path += ';' + (Resolve-Path tools).Path; lint",
    "$env:Path = (Join-Path $PWD 'tools'); lint",
    "$env:Path=(Join-Path $PWD 'tools'); lint",
    "$env:Path = $(Resolve-Path tools); lint",
    '$env:Path = "$(Resolve-Path tools);$env:Path"; lint',
    "$env:Path = Join-Path $PWD tools; lint",
    'pwsh -c "$env:Path = (Resolve-Path tools).Path; lint"',
  ];
  for (const command of unread) assertEquals(span(command).whole, false, command);
});

Deno.test("a bracket in another statement or a comment than PATH's leaves the reading whole", () => {
  for (
    const command of [
      "$env:Path += ';tools'; Write-Host (Get-Date); lint",
      "$env:Path += ';tools' # (from the docs)\nlint",
    ]
  ) {
    const found = span(command);
    assertEquals([targets(found), found.whole], [["tools/lint.ps1"], true], command);
  }
});

Deno.test("a list of quoted strings and PowerShell's PATH is read through, split on its commas", () => {
  const lists = [
    "$env:Path = @('tools', $env:Path) -join ';'; lint",
    "$env:Path = @('bin','tools') -join ';'; lint",
    "$env:Path = 'tools', $env:Path -join ';'; lint",
    '$env:Path = @("tools", "${env:Path}") -join \';\'; lint',
    "$env:Path = @('tools', $env:Path) -join \";\"; lint",
  ];
  for (const command of lists) {
    const found = span(command);
    assertEquals([targets(found), found.whole], [["tools/lint.ps1"], true], command);
  }
});

Deno.test("a list holding anything but a quoted string or PATH is not read whole", () => {
  const unread = [
    "$env:Path = @('tools', $x) -join ';'; lint",
    "$env:Path = @($PWD, $env:Path) -join ';'; lint",
    "$env:Path = @(tools) -join ';'; lint",
    "$env:Path = @('tools', (Resolve-Path bin)) -join ';'; lint",
    "$env:Path = @(\"tools;$x\") -join ';'; lint",
    "$env:Path = 'tools', $x -join ';'; lint",
  ];
  for (const command of unread) assertEquals(span(command).whole, false, command);
});

Deno.test("a pipeline or a call in a PowerShell PATH value is not read whole", () => {
  const unread = [
    "$env:Path = 'x' | ForEach-Object { './tools' }; lint",
    "$env:Path = & { './tools' }; lint",
    "$env:Path = 'tools' && lint",
  ];
  for (const command of unread) assertEquals(span(command).whole, false, command);
});

Deno.test("PowerShell PATH parts joined other than at a `;` are not read whole", () => {
  const unread = [
    "$env:Path = './to' + 'ols;' + $env:Path; lint",
    "$env:Path = @('./to','ols') -join ''; lint",
    "$env:Path = 'tXols' -replace 'X','o'; lint",
    "$env:Path = '{0}ols' -f 'to'; lint",
    "$env:Path = $env:Path + 'tools'; lint",
    "$env:Path += 'tools'; lint",
  ];
  for (const command of unread) assertEquals(span(command).whole, false, command);
});

Deno.test("a variable other than PATH in a PowerShell PATH value is not read whole", () => {
  const unread = [
    '$t = (Resolve-Path tools).Path; $env:Path = "$t;$env:Path"; lint',
    '$tools = Join-Path $PSScriptRoot tools; $env:Path = "$tools;$env:Path"; lint',
    '$env:Path = "${t};$env:Path"; lint',
    "$env:Path = $t + ';' + $env:Path; lint",
  ];
  for (const command of unread) assertEquals(span(command).whole, false, command);
});

Deno.test("a typographic quote in a PowerShell PATH value is not read whole", () => {
  const unread = [
    "$env:Path = '\u2019 + (Resolve-Path tools).Path + \u2019;' + $env:Path; lint",
    '$env:Path = "\u201D + (Resolve-Path tools).Path + \u201C;" + $env:Path; lint',
  ];
  for (const command of unread) assertEquals(span(command).whole, false, command);
});

Deno.test("a PowerShell PATH assigned an empty value, its value on the next line, is not read whole", () => {
  const settings = commandPaths(
    ".claude/settings.json",
    hook("$env:Path =\n(Resolve-Path tools).Path; lint"),
    none,
  );
  assertEquals(settings.whole, false);
});
