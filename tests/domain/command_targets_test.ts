import { assertEquals } from "@std/assert";
import { commandPaths, entryPaths } from "../../src/domain/command_targets.ts";
import { manifestsOf } from "../../src/domain/command_runners.ts";
import { shellSegments, shellWords } from "../../src/domain/shell_words.ts";

/** The paths a judged config's commands may run, read from its strings as text, never run. */

const enc = (s: string) => new TextEncoder().encode(s);
const none = (_path: string) => false;
const has = (paths: readonly string[], ...wanted: string[]) =>
  assertEquals(wanted.filter((w) => !paths.includes(w)), [], paths.join(" "));
const settings = (value: unknown) => enc(JSON.stringify(value));
const hook = (command: string) => settings({ hooks: { Stop: [{ hooks: [{ command }] }] } });
const read = (bytes: Uint8Array, path = ".claude/settings.json", isFolder = none) =>
  commandPaths(path, bytes, isFolder);

Deno.test("(a) quotes are removed and the parts of one word joined, separators split", () => {
  assertEquals(shellWords(`bash "$CLAUDE_PROJECT_DIR"/scripts/x.sh; echo 'a b'`), [
    "bash",
    "$CLAUDE_PROJECT_DIR/scripts/x.sh",
    "echo",
    "a b",
  ]);
  assertEquals(shellWords("a&&b||c|d\ne>f"), ["a", "b", "c", "d", "e", "f"]);
  assertEquals(shellWords('x "$(git rev-parse --show-toplevel)"/y'), [
    "x",
    "$(git rev-parse --show-toplevel)/y",
  ]);
});

Deno.test("a command starts after a separator or a subshell, not inside a word", () => {
  assertEquals(shellSegments("a b; c && (d e) | f"), [["a", "b"], ["c"], ["d", "e"], ["f"]]);
  assertEquals(shellSegments("Bash(npm test:*)"), [["Bash", "npm", "test:*"]]);
});

Deno.test("(b) a leading variable or command up to its first slash is dropped", () => {
  const words = [
    "$CLAUDE_PROJECT_DIR/scripts/a.sh",
    "${ROOT}/b.sh",
    "$(git rev-parse --show-toplevel)/c.sh",
    "$r/d.sh",
    "scripts/$NAME.sh",
  ];
  const paths = entryPaths(words, none);
  has(paths, "scripts/a.sh", "b.sh", "c.sh", "d.sh");
  assertEquals(paths.filter((p) => p.includes("$")), []);
});

Deno.test("after a dropped lead, or the home, each folder suffix is tried", () => {
  const paths = entryPaths(["$HOME/work/proj/scripts/a.sh", "~/proj/tools/b.sh"], none);
  has(paths, "scripts/a.sh", "proj/scripts/a.sh", "tools/b.sh", "proj/tools/b.sh");
});

Deno.test("(c) a word is split on `=` and on `:` too", () => {
  const paths = entryPaths(["--require=./hooks/x.js", "PATH=bin:tools/bin"], none);
  has(paths, "hooks/x.js", "tools/bin");
});

Deno.test("(d) an absolute path tries each of its folder suffixes", () => {
  const paths = entryPaths(["/home/me/proj/scripts/a.sh", "C:\\proj\\b.ps1"], none);
  has(paths, "scripts/a.sh", "proj/scripts/a.sh", "proj/b.ps1", "b.ps1");
});

Deno.test("(e) a word naming a folder puts the others under it; `./` and `\\` normalised", () => {
  const paths = entryPaths(["cd", "tools", "&&", ".\\run.sh"], (p) => p === "tools");
  has(paths, "tools/run.sh", "run.sh");
  assertEquals(entryPaths(["./x/./y.sh"], none).includes("x/y.sh"), true);
});

Deno.test("a command's first word that is a runner reads its folder's manifest", () => {
  has(read(hook("npm run lint")).paths, "package.json");
  has(read(hook("CI=1 exec make -C web"), undefined, (p) => p === "web").paths, "web/GNUmakefile");
  has(read(hook("just check")).paths, "justfile", ".justfile");
  has(read(hook("deno task check")).paths, "deno.json", "deno.jsonc");
});

Deno.test("a runner's name elsewhere than a command's first word reads no manifest", () => {
  const rule = settings({ permissions: { allow: ["Bash(npm test:*)", "Bash(make:*)"] } });
  assertEquals(read(rule).paths.filter((p) => /package\.json|akefile/.test(p)), []);
});

Deno.test("a word named like an object's own property is no runner", () => {
  assertEquals(["constructor", "__proto__", "toString"].map((w) => manifestsOf([w])), [[], [], []]);
  assertEquals(read(hook("constructor; __proto__ && toString")).whole, true);
});

Deno.test("the parse and the bytes are both read: escapes, and what does not parse", () => {
  const escaped = enc('{"hooks": {"Stop": [{"command": "scripts/\\u0078.sh"}]}}');
  has(read(escaped).paths, "scripts/x.sh");
  const broken = read(enc('{"statusLine": {"command": "scripts/status.sh"'));
  has(broken.paths, "scripts/status.sh");
  assertEquals(broken.whole, false);
  assertEquals(read(enc('command = "x" = ['), ".codex/config.toml").whole, false);
});

Deno.test("an object's strings are one entry: a server's cwd holds its args", () => {
  const mcp = settings({ mcpServers: { x: { command: "node", args: ["main.js"], cwd: "srv" } } });
  has(read(mcp, ".mcp.json", (p) => p === "srv").paths, "srv/main.js");
  const toml = enc('[mcp_servers.y]\ncommand = "tools/y.sh"\nargs = ["--flag"]\n');
  has(read(toml, ".codex/config.toml").paths, "tools/y.sh");
});

Deno.test("no word is left unread for being one too many", () => {
  const allow = Array.from({ length: 2100 }, (_, i) => `Read(docs/w${i}.md)`);
  const many = read(settings({ permissions: { allow }, statusLine: { command: "scripts/x.sh" } }));
  has(many.paths, "scripts/x.sh");
  assertEquals(many.whole, true);
});

Deno.test("a source too deep or too large to parse, or a word past a cap, is not read whole", () => {
  const deep = read(enc(`${"[".repeat(100_000)}"scripts/deep.sh"${"]".repeat(100_000)}`));
  has(deep.paths, "scripts/deep.sh");
  assertEquals(deep.whole, false);
  assertEquals(read(enc(`{"a": "${"x ".repeat(140_000)}"}`)).whole, false);
  assertEquals(read(hook(`a${"b".repeat(5000)}`)).whole, false);
  const long = read(hook(`/${Array.from({ length: 40 }, (_, i) => `d${i}`).join("/")}/x.sh`));
  assertEquals(long.whole, false);
  has(long.paths, "d39/x.sh");
  const folders = Array.from({ length: 300 }, (_, i) => `f${i}`);
  const joined = read(hook(folders.join(" ")), undefined, (p) => p.startsWith("f"));
  assertEquals(joined.whole, false);
});
