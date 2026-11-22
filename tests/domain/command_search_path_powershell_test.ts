import { assertEquals } from "@std/assert";
import { commandPaths } from "../../src/domain/command_targets.ts";
import { onPathTargets } from "../../src/domain/command_search_path.ts";
import { pathIndex } from "../../src/domain/path_index.ts";

/**
 * PowerShell's PATH, `$env:Path` or `${env:Path}`, in any letter case: every word after it in its
 * command is read as a value it may be set to, so no way of building the value hides a folder. A
 * command that sets PATH another way, through the `env:` drive or .NET, is not read: its source is
 * named as not fully read.
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
    "$env:Path= 'tools;' + $env:Path; lint",
    "$env:Path+= ';tools'; lint",
    "${env:Path} += ';tools'; lint",
    "${ENV:PATH}='tools;' + ${env:Path}; lint",
    '$env:PATH="tools;$env:Path"; lint',
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
  for (
    const command of ["$env:PathExt += ';.X'; lint", "Write-Host $env:Path; lint", "env:PathExt"]
  ) {
    const found = span(command);
    assertEquals([found.onPath, found.whole], [[], true], command);
  }
});

Deno.test("PowerShell's PATH inside a value is the PATH in effect, braced or not", () => {
  for (const command of ['$env:Path = "tools;$env:Path"', '$env:Path = "tools;${env:Path}"']) {
    assertEquals(span(command).onPath, ["tools"], command);
  }
});
