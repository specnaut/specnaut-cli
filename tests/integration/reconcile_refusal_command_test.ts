import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { snapshot } from "../helpers/tree_snapshot.ts";
import { reconcile, withWork } from "./reconcile_command_fixture.ts";

/**
 * Each reason `specnaut reconcile <path>` refuses, run through `main` as a user's shell runs it
 * (cli#795, from the retired parity scenario `reconcile-path`): exit 2, the reason said, and the
 * whole work folder — the project file, the lock, every staged copy — exactly as it was.
 */

type Refusal = { cwd: "project" | "work"; args: string[]; said: string };

const REFUSALS: Record<string, Refusal> = {
  "a path the lock does not track": {
    cwd: "project",
    args: ["c/untracked.md", "--accept-upstream"],
    said: "error: c/untracked.md is not tracked by Specnaut",
  },
  "a tracked path with no staged copy": {
    cwd: "project",
    args: ["a/unstaged.md", "--accept-upstream"],
    said: "error: no pending reconciliation for a/unstaged.md",
  },
  "a staged path whose project file is gone": {
    cwd: "project",
    args: ["a/gone.md", "--accept-current"],
    said: "error: project file a/gone.md does not exist on disk",
  },
  "a folder with no lock": {
    cwd: "work",
    args: ["a/one.md", "--accept-upstream"],
    said: "error: no .specnaut/installed.lock",
  },
};

for (const [what, { cwd, args, said }] of Object.entries(REFUSALS)) {
  Deno.test(`reconcile <path> refuses ${what}, exits 2 and changes nothing`, async () => {
    await withWork(async (work, project) => {
      const before = await snapshot(work);
      // Every refusal has something it could have written: the planted tree is all there.
      assert(before.has("project/.specnaut/installed.lock"));
      assert(before.has("project/.specnaut/upgrade-staging/a/one.md"));
      const { code, stdout, stderr } = await reconcile(cwd === "work" ? work : project, ...args);
      assertEquals(code, 2, stderr);
      assertStringIncludes(stderr, said);
      assertEquals(stdout.includes("reconciled"), false, stdout);
      assertEquals(await snapshot(work), before);
    });
  });
}
