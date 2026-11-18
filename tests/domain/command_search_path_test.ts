import { assertEquals } from "@std/assert";
import { commandPaths } from "../../src/domain/command_targets.ts";
import { onPathTargets } from "../../src/domain/command_search_path.ts";
import { type IndexedPath, pathIndex } from "../../src/domain/path_index.ts";

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

Deno.test("a word holding a slash, or setting a variable, is not a program; any other may be", () => {
  const programs = read(hook("CI=1 exec ./tools/x.sh && scripts/y.sh; make")).programs;
  assertEquals(sorted(programs), ["command", "exec", "make"]);
});

Deno.test("the program a wrapper runs is read, in each form a wrapper takes", () => {
  const wrapped = [
    "timeout 30 fmt-check",
    "nohup fmt-check &",
    "nice -n 5 fmt-check",
    "git ls-files | xargs fmt-check",
    "sudo -u ci fmt-check",
    "env -i fmt-check",
    "bash -c 'cd web && fmt-check --all'",
  ];
  const missed = wrapped.filter((c) => !read(hook(c)).programs.includes("fmt-check"));
  assertEquals(missed, []);
});

Deno.test("a PATH folder holding a variable past its start is not read, and the reading is not whole", () => {
  const found = read(json({ env: { PATH: "./bin:./tools/$OS/bin:$PATH" } }));
  assertEquals([found.onPath, found.whole], [["bin"], false]);
  const plain = read(json({ env: { PATH: "./bin:$CLAUDE_PROJECT_DIR/tools:$PATH" } }));
  assertEquals(plain.whole, true);
});

Deno.test("`.` on PATH is the project's folder", () => {
  assertEquals(read(json({ env: { PATH: ".:$PATH" } })).onPath, [""]);
});

Deno.test("a program a `$(…)`, a backquote or a `-c` string runs is read with PATH set", () => {
  const env = { env: { PATH: "./bin:$PATH" } };
  for (const command of ["$(lint)", "x=`lint --all`", "bash -c 'lint --all'"]) {
    const found = read(hook(command, env));
    assertEquals([found.onPath, found.programs.includes("lint")], [["bin"], true], command);
  }
});

Deno.test("a lone variable other than PATH on PATH is the project's folder, and stays whole", () => {
  for (const PATH of ["$CLAUDE_PROJECT_DIR:$PATH", "${CLAUDE_PROJECT_DIR}/:$PATH", "${ROOT}"]) {
    const found = read(json({ env: { PATH } }));
    assertEquals([found.onPath, found.whole], [[""], true], PATH);
  }
  assertEquals(read(json({ env: { PATH: "$PATH:${PATH}" } })).onPath, []);
});

Deno.test("a variable past the start of another key `path` skips that folder, and stays whole", () => {
  const args = ["--out-path=a/$X/b", "--out-PATH=c/$X/d"];
  const found = read(json({ servers: { x: { path: "docs/$LANG/bin", args } } }));
  assertEquals(found.whole, true);
  // A command's span is read through its words alone: no raw line sees the `PATH=` there.
  const span = read(enc("Run !`PATH=./tools/$OS/bin:$PATH lint`\n"), ".claude/commands/c.md");
  assertEquals(span.whole, false);
});

const listing = (...paths: [string, IndexedPath["kind"]][]) =>
  pathIndex(paths.map(([path, kind]) => ({ path, kind })));
const HELD = listing(
  ["bin/lint", "blob"],
  ["tools/Fmt.CMD", "blob"],
  ["docs/lint", "blob"],
  ["vendor", "link"],
);

Deno.test("a folder on PATH is tried with the names it holds, bare or with a Windows extension", () => {
  const read = { whole: true };
  const on = { folders: ["bin", "a/../tools", "nowhere", "."], programs: ["lint", "fmt", "npm"] };
  assertEquals(sorted(onPathTargets(on, [HELD], read)), ["bin/lint", "tools/Fmt.CMD"]);
  assertEquals(read.whole, true);
  const root = listing(["lint.ps1", "blob"]);
  assertEquals(onPathTargets({ folders: [""], programs: ["lint"] }, [root], read), ["lint.ps1"]);
});

Deno.test("a folder a link is on the way to is tried with every program and every such name", () => {
  const on = { folders: ["vendor/bin"], programs: ["lint", "fmt"] };
  assertEquals(sorted(onPathTargets(on, [HELD], { whole: true })), [
    "vendor/bin/Fmt.CMD",
    "vendor/bin/fmt",
    "vendor/bin/lint",
  ]);
});

Deno.test("words by the thousand try nothing more; past the cap of a link's folders, not whole", () => {
  const words = Array.from({ length: 100_000 }, (_, i) => `w${i}`);
  const folders = Array.from({ length: 300 }, (_, i) => `f${i}`);
  const read = { whole: true };
  assertEquals(onPathTargets({ folders, programs: words }, [HELD], read), []);
  assertEquals(read.whole, true);
  const linked = folders.map((f) => `vendor/${f}`);
  onPathTargets({ folders: linked, programs: words.slice(0, 300) }, [HELD], read);
  assertEquals(read.whole, false);
});
