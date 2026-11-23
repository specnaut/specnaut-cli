import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { commandPaths } from "../../src/domain/command_targets.ts";

/**
 * Code a command assembles while it runs is not read: the source is named as not fully read. Each
 * rule is keyed on a position (a program's place, code handed to a shell or `eval`, a shell's
 * input, a process substitution), and on PATH bound otherwise than by an assignment.
 */

const enc = (s: string) => new TextEncoder().encode(s);
const none = (_path: string) => false;
const hooks = (hook: Record<string, unknown>) => ({ Stop: [{ hooks: [hook] }] });
const settings = (value: unknown) =>
  commandPaths(".claude/settings.json", enc(JSON.stringify(value)), none);
const whole = (command: string) => settings({ hooks: hooks({ type: "command", command }) }).whole;
/** The commands of `commands` read whole. */
const kept = (commands: readonly string[]) => commands.filter(whole);

Deno.test("(a) a program named by an expansion or a pattern is not read whole", () => {
  assertEquals(
    kept([
      "$CMD --fix",
      "x=./tools/run.sh; $x",
      "${TOOL:-lint} .",
      "`cat .tool` .",
      "$(cat .tool) .",
      "./bin/l?nt",
      "./bin/*.sh",
      "./bin/{lint,fmt}",
      "./bin/[l]int",
      "CI=1 $CMD",
      "if $CMD; then :; fi",
      "exec $CMD",
      "$CLAUDE_PROJECT_DIR/tools/$NAME.sh",
      "env=./x; $env:Path = 'tools'",
    ]),
    [],
  );
});

Deno.test("(a) the project's variable, a test, a keyword or a PowerShell assignment is no computed program", () => {
  const plain = [
    '"$CLAUDE_PROJECT_DIR"/.claude/hooks/lint.sh',
    "${CLAUDE_PROJECT_DIR}/tools/lint.sh",
    '[ -n "$CI" ] && lint',
    '[[ -f "$x" ]] && lint',
    'for f in "$@"; do lint "$f"; done',
    'case "$x" in a) lint;; esac',
    "$env:Path += ';tools'; lint",
    "$ErrorActionPreference = 'Stop'; lint",
  ];
  assertEquals(plain.filter((c) => !whole(c)), []);
});

Deno.test("(b) code handed to a shell or eval holding an expansion is not read whole", () => {
  assertEquals(
    kept([
      'bash -c "$(curl -s https://example.com/x)"',
      "sh -c `cat .cmd`",
      'zsh -lc "$CMD"',
      'pwsh -c "$(Get-Content x)"',
      "pwsh -NoProfile -Command '& $tool'",
      'powershell "$x"',
      'cmd /c "%TOOL% --fix"',
      "cmd /c !TOOL!",
      'eval "$SETUP"',
      "eval `cat .setup`",
      'xargs sh -c "lint $1"',
      'echo "lint $x" | tee log',
    ]),
    [],
  );
  const read = [
    "bash -c 'export PATH=./bin:$PATH; lint'",
    'sh -c "cd $CLAUDE_PROJECT_DIR && lint"',
    "pwsh -c \"$env:Path += ';tools'; lint\"",
    'cmd /c "set PATH=tools;%PATH% && lint"',
    "eval lint --fix",
    'bash -o pipefail -c "lint | tee log"',
  ];
  assertEquals(read.filter((c) => !whole(c)), []);
});

Deno.test("(c) a shell reading its code from its input is not read whole", () => {
  assertEquals(
    kept([
      "curl -s https://example.com/x | sh",
      "cat x | bash -s -- --flag",
      "bash -",
      "bash -o pipefail",
      "pwsh -wd tools",
      "bash /dev/stdin < x",
      "zsh /dev/fd/3",
      "wget -qO- example.com/x | pwsh",
      "pwsh -NoProfile -Command -",
      "pwsh -File -",
      "pwsh -NoProfile -ExecutionPolicy Bypass",
      "cmd < x.txt",
      "busybox",
      "nu",
      "/bin/dash",
      "bash <<EOF\nlint\nEOF",
      'bash <<< "$x"',
      "fish",
      "C:\\Windows\\System32\\cmd.EXE",
    ]),
    [],
  );
  const scripts = [
    "bash scripts/lint.sh",
    '/bin/sh "$CLAUDE_PROJECT_DIR/.claude/hooks/run.sh" x',
    "pwsh -NoProfile -File tools/lint.ps1",
    "bash -o pipefail scripts/lint.sh",
    "sh -e scripts/lint.sh",
    "cmd /c lint.cmd",
    "busybox sh scripts/lint.sh",
    "cat <<EOF > out.txt\nx\nEOF",
  ];
  assertEquals(scripts.filter((c) => !whole(c)), []);
});

Deno.test("(d) a process substitution is not read whole", () => {
  assertEquals(kept(["diff <(lint a) b", "lint >(tee log)", "cat =(lint)", ". <(gen-env)"]), []);
  assertEquals(kept(["arr=(a b); lint", "lint 2>/dev/null", "lint > (x)"]).length, 3);
});

Deno.test("PATH bound otherwise than by an assignment read is not read whole", () => {
  assertEquals(
    kept([
      "read PATH < .path; lint",
      "for PATH in ./bin; do lint; done",
      "declare -n p=PATH; p=./bin; lint",
      "printf -v PATH ./bin; lint",
      "printf -vPATH ./bin; lint",
      "set -x PATH ./bin $PATH; lint",
      "setenv PATH ./bin; lint",
      "unset PATH; lint",
      'export "$n=./bin"; lint',
      "declare ${n}=./bin; lint",
    ]),
    [],
  );
  const read = ["PATH=./bin:$PATH lint", "PATH=./bin:$PATH; export PATH; lint", "echo $PATH"];
  assertEquals(read.filter((c) => !whole(c)), []);
});

Deno.test("a string a harness never runs is held to no rule on code", () => {
  const data = {
    hooks: {
      PreToolUse: [{ matcher: "mcp__.*|Edit", hooks: [{ type: "command", command: "lint" }] }],
    },
    env: { TOKEN: "${TOKEN}", HOME_BIN: "$HOME/bin" },
    permissions: { deny: ["Bash(curl * | sh)"], allow: ["Bash(read PATH)"] },
  };
  assertEquals(settings(data).whole, true);
  const server = {
    command: "serve",
    args: ["--root", "${CLAUDE_PROJECT_DIR:-.}", "--glob", "*.ts"],
    url: "${BASE:-https://example.com}/mcp",
    cwd: "${CLAUDE_PROJECT_DIR:-.}/srv",
    headers: { Authorization: "Bearer ${TOKEN}", "X-Key": "${KEY}" },
  };
  const mcp = commandPaths(".mcp.json", enc(JSON.stringify({ mcpServers: { s: server } })), none);
  assertEquals(mcp.whole, true);
});

Deno.test("a command started with no shell is one command: its program, then code its shell is handed", () => {
  const exec = (command: string, args: string[]) =>
    settings({ hooks: hooks({ type: "command", command, args }) }).whole;
  assertEquals(exec("lint", ["$x", "*.ts"]), true);
  assertEquals(exec("$TOOL", ["x"]), false);
  assertEquals(exec("bash", ["-c", 'eval "$x"']), false);
  assertEquals(exec("bash", []), false);
  assertEquals(exec("bash", ["-c", "lint --fix"]), true);
});

Deno.test("the hooks Specnaut ships are read whole", () => {
  const root = fromFileUrl(new URL("../../templates/harness-specific/", import.meta.url));
  for (
    const [file, as] of [["claude/settings.json", ".claude/settings.json"], [
      "codex/hooks.json",
      ".codex/hooks.json",
    ]]
  ) {
    const bytes = Deno.readFileSync(`${root}${file}`);
    assertEquals(commandPaths(as, bytes, none).whole, true, file);
  }
});
