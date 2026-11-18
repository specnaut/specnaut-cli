import { assertEquals } from "@std/assert";
import { commandPaths } from "../../src/domain/command_targets.ts";

/**
 * A command a command runs inside itself is read as a command of its own: the inside of a `$(…)`
 * or of a backquoted command, and a word that is itself a command line (`bash -c '…'`).
 */

const enc = (s: string) => new TextEncoder().encode(s);
/**
 * A slash command's ```! block: read through the shell's words alone, where a config's bytes are
 * also read line by line, which would find a nested path whether the nesting is read or not.
 */
const read = (command: string, isFolder = (_path: string) => false) =>
  commandPaths(".claude/commands/c.md", enc(`\`\`\`!\n${command}\n\`\`\`\n`), isFolder);
const has = (paths: readonly string[], ...wanted: string[]) =>
  assertEquals(wanted.filter((w) => !paths.includes(w)), [], paths.join(" "));

Deno.test("the command inside a `$(…)` or a backquote names the file it runs", () => {
  has(read('echo "$(tools/ctx.sh)"').paths, "tools/ctx.sh");
  has(read("x=`scripts/tick.sh --once`").paths, "scripts/tick.sh");
  has(read('echo "${X:-$(tools/default.sh)}"').paths, "tools/default.sh");
  assertEquals(read('echo "$(tools/ctx.sh)"').whole, true);
});

Deno.test("a word that is a command line is read as one, in any form a shell is handed it", () => {
  const web = (path: string) => path === "web";
  has(read("bash -c 'cd web && ./run.sh'", web).paths, "web/run.sh");
  has(read("bash -c 'tools/x.sh --fast'").paths, "tools/x.sh");
  has(read(`sh -lc "eval 'tools/deep.sh -q'"`).paths, "tools/deep.sh");
});

Deno.test("a command nested in a command nested in another is read, level by level", () => {
  const found = read("bash -c 'echo \"$(cat $(tools/inner.sh --list))\"'");
  has(found.paths, "tools/inner.sh");
  assertEquals(found.whole, true);
});

Deno.test("past the nesting cap, what is left is not read, and the reading is not whole", () => {
  const deep = read(`echo ${"$(".repeat(40)}tools/deep.sh${")".repeat(40)}`);
  assertEquals([deep.paths.includes("tools/deep.sh"), deep.whole], [false, false]);
});

Deno.test("an escaped backquote inside a backquoted command opens a command of its own", () => {
  // Bash reads `` \` `` inside backquotes as a backquote of the nested command, not as the close.
  for (const command of ["echo `echo \\`tools/x.sh\\``", 'echo "`echo \\`tools/x.sh\\``"']) {
    const found = read(command);
    has(found.paths, "tools/x.sh");
    assertEquals(found.whole, true, command);
  }
  const web = (path: string) => path === "web";
  has(read("echo `echo \\`cd web && ./run.sh\\``", web).paths, "web/run.sh");
});
