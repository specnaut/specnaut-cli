import { assertEquals } from "@std/assert";
import { acrossSources, commandPaths } from "../../src/domain/command_targets.ts";

/**
 * A folder a value surely setting PATH builds from an expansion names no folder that can be known:
 * the reading is not whole. The one exception is the project's folder as the harness sets it,
 * `$CLAUDE_PROJECT_DIR`, read as that folder while no source spells its name any other way.
 */

const enc = (s: string) => new TextEncoder().encode(s);
const none = (_path: string) => false;
const json = (value: unknown) => enc(JSON.stringify(value));
const span = (command: string) =>
  commandPaths(".claude/commands/c.md", enc(`Run !\`${command}\`\n`), none);
const env = (PATH: string, extra: Record<string, unknown> = {}) =>
  commandPaths(".claude/settings.json", json({ env: { PATH }, ...extra }), none);

Deno.test("a PATH piece built from an expansion other than PATH is not read whole", () => {
  const built = [
    'T=tools; PATH="$T:$PATH" lint',
    'T=tools; PATH="$T/bin:$PATH" lint',
    'T=tools; PATH="$T/:$PATH" lint',
    "PATH=${X:+tools}:$PATH lint",
    "PATH=$(cat .dir):$PATH lint",
    "PATH=${PATH:+tools}:$PATH lint",
    "PATH=$HOME/bin:$PATH lint",
    "PATH=$PWD/bin:$PATH lint",
    "PATH=$CLAUDE_PLUGIN_ROOT/bin:$PATH lint",
    "PATH=$1/bin:$PATH lint",
  ];
  assertEquals(built.filter((command) => span(command).whole), []);
  assertEquals([env("${ROOT}").whole, env("`cat .dir`:$PATH").whole], [false, false]);
});

Deno.test("the project's variable, exactly so spelled, is the project's folder", () => {
  for (const PATH of ["$CLAUDE_PROJECT_DIR/bin:$PATH", "${CLAUDE_PROJECT_DIR}/bin:${PATH}"]) {
    const found = env(PATH);
    assertEquals([found.onPath, found.whole, found.leansOnProject], [["bin"], true, true], PATH);
  }
  for (const PATH of ["$CLAUDE_PROJECT_DIR:$PATH", "${CLAUDE_PROJECT_DIR}/:$PATH"]) {
    assertEquals([env(PATH).onPath, env(PATH).whole], [[""], true], PATH);
  }
});

Deno.test("the project's variable in another form, or with more after it, is not read whole", () => {
  const other = [
    "${CLAUDE_PROJECT_DIR:-x}/bin",
    "${CLAUDE_PROJECT_DIR}x/bin",
    "$CLAUDE_PROJECT_DIRx/bin",
    "$CLAUDE_PROJECT_DIR/$OS/bin",
    "$claude_project_dir/bin",
  ];
  assertEquals(other.filter((PATH) => env(PATH).whole), []);
});

Deno.test("a source spelling the project's variable otherwise cancels it as the project's folder", () => {
  const PATH = "$CLAUDE_PROJECT_DIR/bin:$PATH";
  const respelled = [
    "CLAUDE_PROJECT_DIR=/tmp lint",
    "export CLAUDE_PROJECT_DIR=/tmp",
    "read CLAUDE_PROJECT_DIR",
    "declare CLAUDE_PROJECT_DIR=/tmp",
    "for CLAUDE_PROJECT_DIR in /tmp; do lint; done",
    "printf -v CLAUDE_PROJECT_DIR /tmp",
    ": ${CLAUDE_PROJECT_DIR:=/tmp}",
    'export CLAUDE_PROJECT_"DIR"=/tmp',
    "$env:CLAUDE_PROJECT_DIR = 'C:\\tmp'",
    "$env:CLAUDE_PROJECT_DI`R = 'C:\\tmp'",
    "$env:CLAUDE_PROJECT_DIR <#c#>= 'C:\\tmp'",
  ];
  const kept = respelled.filter((command) => env(PATH, { statusLine: { command } }).whole);
  assertEquals(kept, []);
  const key = enc(`{"env": {"PATH": "${PATH}", "CLAUDE_PROJECT_\\u0044IR": "/tmp"}}`);
  assertEquals(commandPaths(".claude/settings.json", key, none).whole, false);
  // Spelled through an escape the parse reads, and a comment only PowerShell's reading takes off.
  const escaped = `$env:CLAUDE_PROJECT_\\u0044IR <#c#>= 'x'`;
  const string = enc(`{"env": {"PATH": "${PATH}"}, "statusLine": {"command": "${escaped}"}}`);
  assertEquals(commandPaths(".claude/settings.json", string, none).whole, false);
  // A key met twice is parsed once, as its last value: the text as written holds the first.
  const twice = `"statusLine": {"command": "export CLAUDE_PROJECT_DIR=/tmp"}`;
  const duplicated = `{"env": {"PATH": "${PATH}"}, ${twice}, "statusLine": {"command": "lint"}}`;
  assertEquals(commandPaths(".claude/settings.json", enc(duplicated), none).whole, false);
});

Deno.test("a binding through an expansion, or eval, cancels the project's variable", () => {
  const PATH = "$CLAUDE_PROJECT_DIR/bin:$PATH";
  const bound = [
    'eval "$x"',
    'export "$n=/tmp"',
    "declare ${n}=/tmp",
    "typeset $n=/tmp",
    "local $n",
    "readonly $n=/tmp",
    "read $n",
    "printf -v $n /tmp",
    "printf -v$n /tmp",
    "env ${n}DIR=/tmp lint",
    "mapfile $n",
    "readarray -t $n",
    "getopts ab $n",
    'let "$n=1"',
    "read -a$n",
  ];
  assertEquals(bound.filter((command) => env(PATH, { statusLine: { command } }).whole), []);
});

Deno.test("reading the project's variable leaves it the project's folder", () => {
  const PATH = "$CLAUDE_PROJECT_DIR/bin:$PATH";
  const read = [
    'bash "$CLAUDE_PROJECT_DIR/x.sh"',
    'sh "${CLAUDE_PROJECT_DIR}/x.sh"',
    'pwsh -File "$env:CLAUDE_PROJECT_DIR/x.ps1"',
    "Write-Host ${env:CLAUDE_PROJECT_DIR}",
    "export PATH=$PATH:x",
    "printf '%s' \"$x\"",
  ];
  const lost = read.filter((command) => !env(PATH, { statusLine: { command } }).whole);
  assertEquals(lost, []);
});

Deno.test("a source that rebinds the project's variable cancels it in every other source", () => {
  const leans = env("$CLAUDE_PROJECT_DIR/bin:$PATH");
  const rebinds = commandPaths(
    ".claude/commands/c.md",
    enc("Run !`export CLAUDE_PROJECT_DIR=/tmp`\n"),
    none,
  );
  assertEquals([leans.whole, rebinds.whole, rebinds.rebindsProject], [true, true, true]);
  assertEquals(acrossSources([leans, rebinds]).map((f) => f.whole), [false, true]);
  assertEquals(acrossSources([leans, env("./bin:$PATH")]).map((f) => f.whole), [true, true]);
});
