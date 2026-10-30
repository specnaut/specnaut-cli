import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { git } from "./git_sandbox.ts";
import { BRANCH, files, shipped } from "./remove_spec_fixture.ts";

/**
 * cli#711 — the layers of remove-spec.sh a refusal by name never reaches: a
 * link on the path (the directory itself, or the `.specnaut/specs` root above
 * it), files git does not track under it, and the one doc that maps its exits.
 */

Deno.test(
  "a feature directory that is a link is skipped, and what it points at is untouched",
  {
    // A directory link needs a privilege the Windows runner does not grant; the check is the same.
    ignore: Deno.build.os === "windows",
  },
  async () => {
    const link = await shipped(".specnaut/specs/008-link");
    try {
      await Deno.symlink("../../src", join(link.work, ".specnaut/specs/008-link"), { type: "dir" });
      const src = await files(join(link.work, "src"));
      const r = await link.script("remove-spec.sh", "008-link");
      assertEquals(r.code, 22, r.stderr);
      assertStringIncludes(r.stderr, "is a link");
      assertEquals(await files(join(link.work, "src")), src);
    } finally {
      await link.cleanup();
    }
  },
);

Deno.test(
  "a .specnaut/specs root that is a link resolves outside the repository, and is skipped",
  {
    // Same privilege as above: Windows cannot create the directory link this case needs.
    ignore: Deno.build.os === "windows",
  },
  async () => {
    // The feature directory itself is a real directory named like the branch, and
    // in history: only the root it sits under is a link, so every earlier layer
    // passes and the resolved-root comparison is the one that has to refuse.
    const sb = await shipped();
    try {
      const outside = join(sb.root, "elsewhere");
      await Deno.rename(join(sb.work, ".specnaut/specs"), outside);
      await Deno.symlink(outside, join(sb.work, ".specnaut/specs"), { type: "dir" });
      const tree = await files(outside);
      const head = await git(sb.work, "rev-parse", "HEAD");
      const r = await sb.script("remove-spec.sh", BRANCH);
      assertEquals(r.code, 22, r.stderr);
      assertStringIncludes(r.stderr, "resolves outside");
      assertEquals(await files(outside), tree, "the linked-to tree moved");
      assertEquals(await git(sb.work, "rev-parse", "HEAD"), head, "a commit was made");
    } finally {
      await sb.cleanup();
    }
  },
);

Deno.test("untracked and ignored files under the directory are reported, kept, and never called removed", async () => {
  // They are in no commit: deleting them would not be lossless, so they stay.
  const sb = await shipped();
  try {
    await sb.commit(".gitignore", "*.log\n", "chore: ignore logs");
    const dir = join(sb.work, `.specnaut/specs/${BRANCH}`);
    await Deno.writeTextFile(join(dir, "my notes.md"), "mine\n");
    await Deno.writeTextFile(join(dir, "run.log"), "ignored\n");
    const r = await sb.script("remove-spec.sh", BRANCH);
    assertEquals(r.code, 24, r.stderr);
    // Quoted, so a name with a space reads as one path.
    assertStringIncludes(r.stderr, `.specnaut/specs/${BRANCH}/my\\ notes.md`);
    assertStringIncludes(r.stderr, `.specnaut/specs/${BRANCH}/run.log`);
    assert(!r.stdout.includes("remove-spec: removed"), `claimed removed: ${r.stdout}`);
    assertEquals(await files(dir), ["my notes.md:mine\n", "run.log:ignored\n"]);
    // The tracked half is lossless, so it still went: committed and pushed.
    assertEquals(
      await git(sb.remote, "log", "-1", "--format=%s", "main"),
      "chore(7): remove the spec directory for the shipped feature",
    );
    assertEquals(await git(sb.work, "ls-files", ".specnaut/specs"), "");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("merge-close.md maps every exit remove-spec.sh's header lists, and restates none of its conditions", async () => {
  // One exit-table home per script: the header. One doc maps it (cli#711).
  const read = (p: string) => Deno.readTextFile(new URL(`../../${p}`, import.meta.url));
  const header = await read("templates/core/specnaut/scripts/bash/remove-spec.sh");
  const codes = [...header.matchAll(/^#\s{3}(\d+)\s/gm)].map((m) => m[1]);
  assertEquals(codes.sort(), ["0", "2", "22", "23", "24", "25", "3", "7"]);
  const doc = await read("templates/core/skills/task/phases/merge-close.md");
  const step = doc.slice(doc.indexOf("remove-spec.sh <branch>"), doc.indexOf("## The report"));
  // A bullet's bold lead names the exits it maps: `- **24** —`, `- **2 · 3** —`.
  const mapped = [...step.matchAll(/^\s*- \*\*([^*]+)\*\*/gm)].flatMap((m) =>
    m[1].match(/\d+/g) ?? []
  );
  assertEquals(mapped.sort(), codes, "the bullets map a different set of exits");
  // The conditions live in the script; the doc points there instead of re-listing them.
  assert(
    !step.includes("directly under `.specnaut/specs/`"),
    "merge-close.md restates a condition",
  );
  assertStringIncludes(step, "the script's header");
});
