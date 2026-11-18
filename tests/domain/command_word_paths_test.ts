import { assert, assertEquals } from "@std/assert";
import { commandPaths } from "../../src/domain/command_targets.ts";
import { matching } from "../../src/domain/command_word_paths.ts";
import { pathIndex } from "../../src/domain/path_index.ts";

/**
 * A path a command builds around a variable it cannot know (`scripts/$NAME.sh`) is a pattern the
 * listing is matched against; an absolute path is tried from above a project in a subfolder too.
 */

const enc = (s: string) => new TextEncoder().encode(s);
const none = (_path: string) => false;
const hook = (command: string) =>
  enc(JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command }] }] } }, null, 2));
const read = (command: string, depth = 0) =>
  commandPaths(".claude/settings.json", hook(command), none, depth);
const index = (...paths: string[]) => pathIndex(paths.map((path) => ({ path, kind: "blob" })));
const matched = (command: string, ...paths: string[]) =>
  matching(read(command).patterns, index(...paths)).sort();

Deno.test("a variable inside a path matches any name there, in any letter case", () => {
  const held = ["scripts/lint.sh", "Scripts/Fmt.SH", "scripts/a/deep.sh", "scripts/x.ts", "y.sh"];
  assertEquals(matched("bash scripts/$NAME.sh", ...held), [
    "Scripts/Fmt.SH",
    "scripts/a/deep.sh",
    "scripts/lint.sh",
  ]);
  assertEquals(matched("tools/lint-${KIND}", "tools/lint-js", "tools/fmt-js"), ["tools/lint-js"]);
  assertEquals(matched("run-$X.sh", "run-a.sh", "tools/run-b.sh"), ["run-a.sh"]);
  assertEquals(matched("bash Tools/$N.SH", "tools/x.sh"), ["tools/x.sh"]);
  // Each part is found after the one before, and never inside the end the last part takes.
  assertEquals(matched("bash t/${X}ab${X}b", "t/ab", "t/abb", "t/bab"), ["t/abb"]);
});

Deno.test("a command inside the path, slashes and all, is one variable", () => {
  assertEquals(matched("tools/$(basename a/b).sh", "tools/b.sh", "a/b.sh"), ["tools/b.sh"]);
});

Deno.test("a backquoted command in a path ends where bash ends it, past an escaped backquote", () => {
  const nested = 'bash "tools/`echo \\`uname\\``/run.sh"';
  assertEquals(matched(nested, "tools/linux/run.sh", "tools/run.sh"), ["tools/linux/run.sh"]);
  // In a command's block, read through its words alone: a config's raw lines would find these.
  const block = (command: string) =>
    commandPaths(".claude/commands/c.md", enc(`\`\`\`!\n${command}\n\`\`\`\n`), none).paths;
  assert(block('bash "`cd \\`dirname a/b\\``/tools/x.sh"').includes("tools/x.sh"));
  assert(block('bash "$CLAUDE_PROJECT_DIR\\tools\\x.sh"').includes("tools/x.sh"));
});

Deno.test("a file name that is a variable alone is no pattern: it would name every file", () => {
  const found = read('prettier --write "$CLAUDE_PROJECT_DIR/$FILE" scripts/$NAME src/$A/$B');
  assertEquals(found.patterns, []);
  assertEquals(found.whole, true);
});

Deno.test("a path that names no folder before a variable is no pattern: it would name every file", () => {
  assertEquals(read('bash "$CLAUDE_PROJECT_DIR"/scripts/$TASK.sh').patterns, ["scripts/\0.sh"]);
  for (const command of ["bash $X.sh", 'deno test "${f%.ts}_test.ts"', 'bash "$DIR"/$NAME.sh']) {
    assertEquals(read(command).patterns, [], command);
  }
});

Deno.test("an absolute path with a variable is tried from each suffix after it", () => {
  const found = read("/home/$USER/proj/scripts/x.sh");
  assert(found.paths.includes("scripts/x.sh") && found.paths.includes("proj/scripts/x.sh"));
  assertEquals(found.paths.filter((p) => p.includes("$")), []);
  // A suffix that starts at the variable adds nothing its literal tail does not: no pattern.
  assertEquals(found.patterns.filter((p) => p.startsWith("\0")), []);
});

Deno.test("an assignment is read for its value, never as a whole name", () => {
  assertEquals(read("r=$PWD; X=tools/$N.sh").patterns, ["tools/\0.sh"]);
});

Deno.test("past the pattern cap, the reading is not whole", () => {
  const many = Array.from({ length: 100 }, (_, i) => `t${i}/$X.sh`).join(" ");
  assertEquals(read(many).whole, false);
  assertEquals(read("t/$X.sh").whole, true);
});

Deno.test("an absolute path is tried from each folder above a project in a subfolder", () => {
  const deep = read("/home/me/repo/scripts/x.sh", 2).paths;
  for (
    const p of ["scripts/x.sh", "../scripts/x.sh", "../../scripts/x.sh", "../repo/scripts/x.sh"]
  ) {
    assert(deep.includes(p), `${p} not in ${deep.join(" ")}`);
  }
  assertEquals(read("/home/me/repo/scripts/x.sh").paths.some((p) => p.startsWith("..")), false);
  assert(read("$CLAUDE_PROJECT_DIR/../shared/x.sh", 1).paths.includes("../shared/x.sh"));
});

Deno.test("a pattern of many variables against a long name is matched without backtracking", () => {
  // `t/${X}a${X}a…${X}c${X}b` against `t/aa…ab`: a backtracking matcher tries each way to place
  // the `a`s before it finds no `c`, so many that it never ends, and the test with it.
  const word = `t/${"${X}a".repeat(24)}\${X}c\${X}b`;
  assertEquals(matched(word, `t/${"a".repeat(200)}b`, `t/${"a".repeat(30)}cb`), [
    `t/${"a".repeat(30)}cb`,
  ]);
});

Deno.test("a `..` after a variable reads as no one path, and the reading is not whole", () => {
  const found = read("bash tools/$OS/../run.sh");
  assertEquals([found.paths.includes("tools/run.sh"), found.patterns, found.whole], [
    false,
    [],
    false,
  ]);
  assertEquals(read("bash $CLAUDE_PROJECT_DIR/../tools/run.sh").whole, true);
});
