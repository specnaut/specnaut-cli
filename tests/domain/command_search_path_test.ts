import { assertEquals } from "@std/assert";
import { commandPaths } from "../../src/domain/command_targets.ts";
import { onPathTargets } from "../../src/domain/command_search_path.ts";

/**
 * A folder a judged config puts on PATH decides which program a bare command name runs: each
 * source says which folders it puts there and which programs its commands name by name alone.
 */

const enc = (s: string) => new TextEncoder().encode(s);
const none = (_path: string) => false;
const json = (value: unknown) => enc(JSON.stringify(value));
const hook = (command: string, extra: Record<string, unknown> = {}) =>
  json({ ...extra, hooks: { Stop: [{ hooks: [{ type: "command", command }] }] } });
const read = (bytes: Uint8Array, path = ".claude/settings.json") => commandPaths(path, bytes, none);
const sorted = (xs: readonly string[]) => [...xs].sort();

Deno.test("a settings file's env.PATH puts its folders on PATH; a hook's bare name is a program", () => {
  const found = read(
    hook("lint --fix", { env: { PATH: "./bin:$CLAUDE_PROJECT_DIR/tools:$PATH" } }),
  );
  assertEquals(sorted(found.onPath), ["bin", "tools"]);
  assertEquals(found.programs.includes("lint"), true);
});

Deno.test("a PATH set before a command, or exported, is read from the command's words", () => {
  // A command file's text is read for its spans alone, never as raw lines: only the words see it.
  const span = read(enc("Run !`PATH=./bin:$PATH lint` first.\n"), ".claude/commands/c.md");
  assertEquals([span.onPath, span.programs.includes("lint")], [["bin"], true]);
  const exported = read(
    enc('Run !`export PATH="node_modules/.bin:$PATH"; eslint .`\n'),
    ".claude/commands/c.md",
  );
  assertEquals(exported.onPath, ["node_modules/.bin"]);
});

Deno.test("a PATH key spelled with an escape is read through the parse", () => {
  const escaped = enc('{"env": {"P\\u0041TH": "bin3:$PATH"}}');
  assertEquals(read(escaped).onPath, ["bin3"]);
});

Deno.test("Codex's shell policy and an MCP server's env put folders on PATH too", () => {
  const toml = '[shell_environment_policy]\nset = { PATH = "vendor/bin:/usr/bin" }\n';
  assertEquals(read(enc(toml), ".codex/config.toml").onPath.includes("vendor/bin"), true);
  const mcp = json({ mcpServers: { x: { command: "serve", env: { Path: "srv/bin" } } } });
  const found = read(mcp, ".mcp.json");
  assertEquals([found.onPath, found.programs.includes("serve")], [["srv/bin"], true]);
});

Deno.test("a PATH value longer than a word may be is not read, and the reading is not whole", () => {
  const found = read(json({ env: { PATH: `bin:${"x".repeat(5000)}` } }));
  assertEquals([found.onPath, found.whole], [[], false]);
});

Deno.test("a PATH the parser rejects is read from the bytes", () => {
  const broken = enc('{"env": {"PATH": "bin2:$PATH"}, "hooks": ');
  assertEquals(read(broken).onPath, ["bin2"]);
});

Deno.test("a word holding a slash, or before the program, is not a program", () => {
  const programs = read(hook("CI=1 exec ./tools/x.sh && scripts/y.sh; make")).programs;
  assertEquals(sorted(programs), ["make"]);
});

Deno.test("each folder on PATH holds each program, and past the cap the reading is not whole", () => {
  const read = { whole: true };
  assertEquals(sorted(onPathTargets(["bin", "a/../tools"], ["lint", "node"], read)), [
    "bin/lint",
    "bin/node",
    "tools/lint",
    "tools/node",
  ]);
  assertEquals(read.whole, true);
  const many = Array.from({ length: 300 }, (_, i) => `p${i}`);
  onPathTargets(many, many, read);
  assertEquals(read.whole, false);
});
