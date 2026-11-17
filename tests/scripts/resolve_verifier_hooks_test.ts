import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { toolsIn } from "../integration/hook_tools.ts";
import { CALL, hook, START } from "./resolve_verifier_fixture.ts";
import { fired, ifMissing, inLayout } from "./resolve_verifier_layout.ts";

/**
 * What the hooks do past the table of resolve_verifier_test.ts once they have cleaned the PATH: the
 * work they still do with what is left, and the locks and starts they refuse when what was dropped
 * could have been what they needed. Each run plants markers in the dropped entry; none may fire.
 */

Deno.test({
  name:
    "with an in-repo PATH entry and no lock, the call runs and the pass is still removed, by the real tools",
  ignore: Deno.build.os === "windows",
  fn: () =>
    inLayout(async (l, { bash }) => {
      await Deno.remove(join(l.state, "specnaut", "review-lock", "s-1.json"));
      // The markers' folder first: had it been searched, its `git` and `rm` would have run.
      const r = { entries: [l.bin, join(l.tmp, "outside", "real"), l.tools], cwd: l.repo, bash };
      assertEquals(await hook(l, r, "review-lock.sh", CALL), { exit: 0 }, "no lock");
      const pass = join(l.repo, ".git", "specnaut", "review-pass.json");
      await Deno.mkdir(join(l.repo, ".git", "specnaut"));
      await Deno.writeTextFile(pass, "{}\n");
      const ls = '{"tool_input":{"command":"ls"}}';
      assertEquals(await hook(l, r, "review-gate.sh", ls), { exit: 0 }, "a command not a review");
      const left = await Deno.lstat(pass).then(() => true, ifMissing(false));
      assertEquals(left, false, "the pass outlived ls");
      assertEquals(await fired(l), "", "a command the PATH entry supplied ran");
    }),
});

Deno.test({
  name:
    "with the checkout's lock and nothing left on the PATH to ask git with, the call is refused",
  ignore: Deno.build.os === "windows",
  fn: () =>
    inLayout(async (l, { bash }) => {
      // No per-user copy: only the checkout's own lock, which git is needed to find, holds.
      await Deno.remove(join(l.state, "specnaut", "review-lock", "s-1.json"));
      await Deno.mkdir(join(l.repo, ".git", "specnaut", "review-lock"), { recursive: true });
      await Deno.writeTextFile(join(l.repo, ".git", "specnaut", "review-lock", "s-1.json"), "{}\n");
      const r = { entries: [""], cwd: l.bin, bash };
      const want = { refused: "is empty", entry: "", exit: 2 };
      assertEquals(await hook(l, r, "review-lock.sh", CALL), want);
      assertEquals(await fired(l), "", "a command the PATH entry supplied ran");
    }),
});

Deno.test({
  name: "with no `cat` left once the PATH is cleaned, the hooks still read the call and refuse",
  ignore: Deno.build.os === "windows",
  fn: () =>
    inLayout(async (l, { bash }) => {
      // git, env and rm, but no cat: an input read through the PATH would be empty, no session
      // and no start found, and both calls let through.
      await Deno.mkdir(join(l.tmp, "few"));
      const few = await toolsIn(join(l.tmp, "few"), ["git", "env", "rm"]);
      const r = { entries: [l.bin, few], cwd: l.repo, bash };
      const want = { refused: "is inside the repository", entry: l.bin, exit: 2 };
      assertEquals(await hook(l, r, "review-lock.sh", CALL), want, "the held lock's copy");
      assertEquals(await hook(l, r, "review-gate.sh", START), want, "a review's start");
      // The same start with a tab, which the hook reads JSON-escaped, as `\t`.
      const tab = JSON.stringify({ tool_input: { command: "specnaut review\tstart 1" } });
      assertEquals(await hook(l, r, "review-gate.sh", tab), want, "a start spelled with a tab");
      assertEquals(await fired(l), "", "a command the PATH entry supplied ran");
    }),
});
