import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

/**
 * #594 — `specnaut diff` dropped its positional argument on the floor.
 *
 * Reported from a real project: five different arguments and no argument at all
 * produced byte-identical output and exit 0. The cause was not "resolves the
 * wrong file" — the command diffs the WHOLE project every time, so a typo'd
 * path, a path outside the bundle and a correct path were all answered with the
 * same multi-thousand-line dump. The command could not fail.
 *
 * That is the dangerous half: the per-file check is the maintenance duty a
 * `preserve.yml` declaration creates (README, "Declared files are then kept…"),
 * and a confident diff of an unrelated file reads as "no meaningful drift".
 *
 * These assertions are end-to-end on purpose. The unit tests cover the parser
 * and the use case; what was actually shipped broken was the EXIT CODE, and
 * only the real binary produces one.
 */

async function runSpecnaut(args: string[], cwd: string) {
  const { code, stdout, stderr } = await new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", MAIN, ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

const INIT = ["init", "--here", "--no-git", "--ai", "claude", "--backlog", "local"];

Deno.test("diff <path> fails loudly on a path the lock does not track", async () => {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-diff-scope-" });
  try {
    assertEquals((await runSpecnaut(INIT, dir)).code, 0);

    const bogus = await runSpecnaut(
      ["diff", ".specnaut/scripts/backlog/does-not-exist.sh"],
      dir,
    );

    assertEquals(bogus.code, 2, "an unresolvable path must not exit 0");
    assertStringIncludes(bogus.stderr, "does-not-exist.sh");
    assertStringIncludes(bogus.stderr, "not a managed file");
    // The whole-project view must not have run as a fallback: its output is the
    // thing that made the failure look like a success.
    assertEquals(bogus.stdout.includes("---- diff:"), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("diff <path> scopes to one managed file and stays silent about the rest", async () => {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-diff-scope-ok-" });
  try {
    assertEquals((await runSpecnaut(INIT, dir)).code, 0);

    // Two managed files, one edited. Asking about the untouched one must report
    // it clean rather than surfacing the edit to the other.
    const edited = join(dir, ".claude", "CLAUDE.md");
    const original = await Deno.readTextFile(edited);
    await Deno.writeTextFile(edited, original + "\n<!-- local edit -->\n");

    const scoped = await runSpecnaut(["diff", ".claude/agents/developer.md"], dir);
    assertEquals(scoped.code, 0);
    assertStringIncludes(scoped.stdout, "no divergence");
    assertEquals(scoped.stdout.includes("CLAUDE.md"), false);

    // And the whole-project view still sees the edit — scoping narrowed the
    // question, it did not change what the command can find.
    const all = await runSpecnaut(["diff"], dir);
    assertEquals(all.code, 0);
    assertStringIncludes(all.stdout, "CLAUDE.md");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("diff rejects two paths rather than silently using the first", async () => {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-diff-scope-multi-" });
  try {
    assertEquals((await runSpecnaut(INIT, dir)).code, 0);
    const r = await runSpecnaut(["diff", ".claude/CLAUDE.md", ".claude/agents/developer.md"], dir);
    assertEquals(r.code === 0, false, "two paths must not be accepted");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
