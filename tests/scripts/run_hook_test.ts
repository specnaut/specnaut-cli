import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { toolsIn } from "../integration/hook_tools.ts";
import { hermetic } from "./git_sandbox.ts";
import { CALL, HOOKS, launched, spawnWith } from "./resolve_verifier_fixture.ts";
import { fired, inLayout, type Layout } from "./resolve_verifier_layout.ts";

/**
 * The launcher settings.json starts every bash hook through, past the table of
 * resolve_verifier_test.ts: the bash it may not start, and the refusals that say why it started
 * none. A refusal exits 2, the exit Claude Code stops a call on; any other lets the call run.
 */

/** `argv` run in the layout's repository with `entries` as its PATH, CALL on stdin. */
const call = (l: Layout, argv: string[], entries: string[]) =>
  spawnWith(argv, l.repo, {
    ...hermetic(),
    PATH: entries.join(":"),
    CLAUDE_PROJECT_DIR: l.repo,
    XDG_STATE_HOME: l.state,
  }, CALL);

Deno.test({
  name: "launched, a bash on a kept entry that links into the tree is refused, never run",
  ignore: Deno.build.os === "windows",
  fn: () =>
    inLayout(async (l, { bash }) => {
      const links = join(l.tmp, "outside", "bashlink");
      await Deno.mkdir(links);
      await Deno.symlink(join(l.bin, "bash"), join(links, "bash"));
      const r = { entries: [links, join(l.tmp, "outside", "real"), l.tools], cwd: l.repo, bash };
      const want = { refused: "is inside the repository", exit: 2 };
      assertEquals(await launched(l, r, "review-lock.sh", CALL), want);
      assertEquals(await fired(l), "", "the bash the link names ran");
    }),
});

Deno.test({
  name: "with no bash outside the tree, the launcher refuses, naming the entry it dropped if any",
  ignore: Deno.build.os === "windows",
  fn: () =>
    inLayout(async (l) => {
      await Deno.mkdir(join(l.tmp, "few"));
      const few = await toolsIn(join(l.tmp, "few"), ["git", "cat", "env", "rm", "readlink"]);
      const argv = ["/bin/sh", join(HOOKS, "run-hook.sh"), join(HOOKS, "review-lock.sh")];
      const none = await call(l, argv, [join(l.tmp, "outside", "real"), few]);
      assertEquals(none, { code: 2, stderr: "run-hook: no bash on the PATH\n" });
      const dropped = await call(l, argv, [l.bin, few]);
      assertEquals(dropped.code, 2);
      assertStringIncludes(dropped.stderr, `VERIFIER REFUSED: PATH entry '${l.bin}' is inside`);
      assertEquals(await fired(l), "", "a command the PATH entry supplied ran");
    }),
});

Deno.test({
  name: "with _clean-path.sh missing, the launcher and the review hooks refuse, saying so",
  ignore: Deno.build.os === "windows",
  fn: () =>
    inLayout(async (l, { bash }) => {
      const bare = join(l.tmp, "outside", "hooks");
      await Deno.mkdir(bare);
      for (const name of ["run-hook.sh", "review-lock.sh", "review-gate.sh"]) {
        await Deno.copyFile(join(HOOKS, name), join(bare, name));
      }
      const entries = [join(l.tmp, "outside", "real"), l.tools];
      const runs: [string, string[]][] = [
        ["run-hook", ["/bin/sh", join(bare, "run-hook.sh"), join(bare, "review-lock.sh")]],
        ["review-lock", [bash, join(bare, "review-lock.sh")]],
        ["review-gate", [bash, join(bare, "review-gate.sh")]],
      ];
      for (const [who, argv] of runs) {
        const out = await call(l, argv, entries);
        assertEquals(out.code, 2, who);
        assertStringIncludes(out.stderr, `${who}: cannot read ${bare}/_clean-path.sh\n`, who);
      }
    }),
});
