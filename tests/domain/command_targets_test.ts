import { assert, assertEquals } from "@std/assert";
import { commandEntries, entryPaths, MAX_WORDS } from "../../src/domain/command_targets.ts";
import { shellWords } from "../../src/domain/shell_words.ts";

/** The paths a judged config's commands may run, read from its strings as text, never run. */

const enc = (s: string) => new TextEncoder().encode(s);
const none = () => false;
const has = (paths: string[], ...wanted: string[]) =>
  assertEquals(wanted.filter((w) => !paths.includes(w)), [], paths.join(" "));

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

Deno.test("(c) a word is split on `=` and on `:` too", () => {
  has(
    entryPaths(["--require=./hooks/x.js", "PATH=bin:tools/bin"], none),
    "hooks/x.js",
    "tools/bin",
  );
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

Deno.test("a runner reads the manifest of its folder", () => {
  has(entryPaths(["npm", "run", "lint"], none), "package.json");
  has(entryPaths(["make", "-C", "web"], (p) => p === "web"), "Makefile", "web/GNUmakefile");
  has(entryPaths(["just", "check"], none), "justfile", ".justfile");
  has(entryPaths(["deno", "task", "check"], none), "deno.json", "deno.jsonc");
});

Deno.test("the parse and the bytes are both read: escapes, and what does not parse", () => {
  const escaped = enc('{"hooks": {"Stop": [{"command": "scripts/\\u0078.sh"}]}}');
  const paths = commandEntries(".claude/settings.json", escaped).flatMap((e) =>
    entryPaths(e, none)
  );
  has(paths, "scripts/x.sh");
  const broken = enc('{"statusLine": {"command": "scripts/status.sh"');
  const raw = commandEntries(".claude/settings.json", broken).flatMap((e) => entryPaths(e, none));
  has(raw, "scripts/status.sh");
});

Deno.test("an object's strings are one entry: a server's cwd holds its args", () => {
  const mcp = enc('{"mcpServers": {"x": {"command": "node", "args": ["main.js"], "cwd": "srv"}}}');
  const [entry] = commandEntries(".mcp.json", mcp);
  has(entryPaths(entry, (p) => p === "srv"), "srv/main.js");
  const toml = enc('[mcp_servers.y]\ncommand = "tools/y.sh"\nargs = ["--flag"]\n');
  has(commandEntries(".codex/config.toml", toml).flatMap((e) => entryPaths(e, none)), "tools/y.sh");
});

Deno.test("a source too deep to parse is read from its bytes, and each half is capped", () => {
  const deep = enc(`${"[".repeat(100_000)}"scripts/deep.sh"${"]".repeat(100_000)}`);
  has(commandEntries(".mcp.json", deep).flatMap((e) => entryPaths(e, none)), "scripts/deep.sh");
  const many = enc(JSON.stringify(Array.from({ length: 5000 }, (_, i) => `w${i}`)));
  const words = commandEntries(".mcp.json", many).flat();
  assert(words.length <= 2 * MAX_WORDS, `${words.length}`);
});
