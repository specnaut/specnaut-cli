import { assertEquals } from "@std/assert";
import { commandPaths } from "../../src/domain/command_targets.ts";
import { onlyAssignments } from "../../src/domain/sourced_files.ts";

/**
 * A file a command runs in its own process carries its PATH, functions and aliases back into that
 * command. One named as a constant path from the project is handed to the caller to read; any
 * other makes the reading not whole.
 */

const enc = (s: string) => new TextEncoder().encode(s);
const none = (_path: string) => false;
const json = (value: unknown) => enc(JSON.stringify(value));
const hooks = (hook: Record<string, unknown>) => ({ Stop: [{ hooks: [hook] }] });
const read = (command: string) =>
  commandPaths(".claude/settings.json", json({ hooks: hooks({ type: "command", command }) }), none);
/** Whether `command` is read whole, and the files it hands the caller. */
const carried = (command: string) => [read(command).whole, read(command).sourced];

Deno.test("each form naming a repository file hands it to the caller, the reading still whole", () => {
  const forms: [string, string][] = [
    [". ./env.sh && lint", "env.sh"],
    ["source tools/env.sh; lint", "tools/env.sh"],
    ["source -- ./env.sh; lint", "env.sh"],
    ["bash --rcfile ./rc.sh scripts/x.sh", "rc.sh"],
    ["bash --init-file=./rc.sh scripts/x.sh", "rc.sh"],
    ["./tools/env.ps1; lint", "tools/env.ps1"],
    ["& .\\tools\\env.ps1; lint", "tools/env.ps1"],
    [". ./tools/env.ps1; lint", "tools/env.ps1"],
    ["Import-Module ./tools/m.psm1; lint", "tools/m.psm1"],
    ["using module ./tools/m.psm1", "tools/m.psm1"],
    ["call tools\\env.bat && lint", "tools/env.bat"],
    ["tools/env.cmd && lint", "tools/env.cmd"],
    ["BASH_ENV=./env.sh bash scripts/x.sh", "env.sh"],
    ["ENV=./env.sh lint", "env.sh"],
  ];
  for (const [command, file] of forms) assertEquals(carried(command), [true, [file]], command);
});

Deno.test("a form naming no repository file is not read whole", () => {
  const unread = [
    ". ~/.cargo/env; lint",
    "source env.sh; lint",
    'source "$VENV/bin/activate"; lint',
    ". /etc/profile; lint",
    ". ../outside.sh; lint",
    "source",
    "bash --rcfile ~/.rc scripts/x.sh",
    "Import-Module PSReadLine; lint",
    "Import-Module -Force; lint",
    "using module Tools",
    "call env.bat",
    "BASH_ENV=$HOME/.env bash scripts/x.sh",
    "ZDOTDIR=./z zsh scripts/x.zsh",
    "HOME=. lint",
    "XDG_CONFIG_HOME=./cfg lint",
    "export ENV=env.sh; lint",
    "$env:HOME = 'x'; lint",
    "cd sub && . ./env.sh && lint",
  ];
  const kept = unread.filter((command) => read(command).whole);
  assertEquals(kept, []);
  assertEquals(read("cd sub && . ./env.sh && lint").sourced, []);
});

Deno.test("a script run in a process of its own carries nothing back", () => {
  assertEquals(carried("pwsh -NoProfile -File ./tools/x.ps1"), [true, []]);
  assertEquals(carried("bash ./tools/x.sh"), [true, []]);
});

Deno.test("a start-up variable set in a config's environment carries over too", () => {
  const settings = (env: Record<string, string>) =>
    commandPaths(".claude/settings.json", json({ env }), none);
  assertEquals([
    settings({ BASH_ENV: "./env.sh" }).whole,
    settings({ BASH_ENV: "./env.sh" }).sourced,
  ], [
    true,
    ["env.sh"],
  ]);
  for (const key of ["ZDOTDIR", "HOME", "XDG_CONFIG_HOME", "bash_env"]) {
    assertEquals(settings({ [key]: "~/x" }).whole, false, key);
  }
  // A server run from a folder of its own reads a relative path from there.
  const server = { command: "bash", args: ["-c", ". ./env.sh && serve"] };
  const mcp = (s: object) => commandPaths(".mcp.json", json({ mcpServers: { s } }), none);
  assertEquals([mcp(server).whole, mcp(server).sourced], [true, ["env.sh"]]);
  const moved = mcp({ ...server, cwd: "srv" });
  assertEquals([moved.whole, moved.sourced], [false, []]);
  assertEquals(read("env -C sub bash -c '. ./env.sh && lint'").whole, false);
});

Deno.test("a file of assignments of constants, PATH or the project's variable is all one may carry", () => {
  const plain = [
    "",
    "# tools",
    'export PATH="./bin:$PATH"',
    "PATH=${CLAUDE_PROJECT_DIR}/bin:${PATH}",
    "export NODE_ENV=production",
    "LABEL='a b'",
    "﻿X=1\r\nY=2",
  ];
  assertEquals(plain.filter((t) => !onlyAssignments(t)), []);
  const other = [
    "lint",
    ". ./more.sh",
    "source ./env.sh",
    'export PATH="$HOME/bin:$PATH"',
    "PATH=$(pwd)/bin",
    "PATH=`pwd`/bin",
    "PATH=~/bin:$PATH",
    "alias lint=./x",
    "lint() { ./x; }",
    "hash -p ./x lint",
    "X=1; lint",
    "X=a b",
    "export BASH_ENV=./x",
    "ZDOTDIR=./z",
    "export PATH",
    'X="$PATHX"',
  ];
  assertEquals(other.filter(onlyAssignments), []);
});
