import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { git, sandbox } from "./git_sandbox.ts";
import { BRANCH, files, shipped, state } from "./remove_spec_fixture.ts";

/**
 * cli#760 FR-6 — `remove-spec.sh --marker-only <n>` removes .specnaut/feature.json
 * alone, so a closeout always clears its marker, a feature directory or not.
 */

/** A landing whose marker names no directory: the cloud shape. */
async function cloudLanding(link = 7) {
  const sb = await sandbox();
  await sb.commit("src/app.ts", "export {};\n", "feat(7): x");
  await sb.commit(".specnaut/feature.json", `{ "linked_issue": ${link} }\n`, "plan(7): link");
  await git(sb.work, "push", "--quiet", "origin", "main");
  return sb;
}

Deno.test("it removes the marker alone, in one commit naming the item, pushed", async () => {
  const sb = await cloudLanding();
  try {
    const r = await sb.script("remove-spec.sh", "--marker-only", "7");
    assertEquals(r.code, 0, r.stderr);
    assertEquals(
      await git(sb.remote, "log", "-1", "--format=%s", "main"),
      "chore(7): remove the feature marker for the shipped item",
    );
    assertEquals(
      await git(sb.work, "show", "--name-status", "--format=", "HEAD"),
      "D\t.specnaut/feature.json",
    );
    assertEquals(await git(sb.work, "status", "--porcelain"), "");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("it never touches a directory the marker names: only the file goes", async () => {
  const sb = await shipped();
  try {
    const tree = await files(join(sb.work, ".specnaut/specs"));
    const r = await sb.script("remove-spec.sh", "--marker-only", "7");
    assertEquals(r.code, 0, r.stderr);
    assertEquals(
      await git(sb.work, "show", "--name-status", "--format=", "HEAD"),
      "D\t.specnaut/feature.json",
    );
    assertEquals(await files(join(sb.work, ".specnaut/specs")), tree);
    assertEquals(
      await git(sb.work, "ls-files", `.specnaut/specs/${BRANCH}`),
      `.specnaut/specs/${BRANCH}/plan.md`,
    );
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a marker linking another item is 22, and nothing changes", async () => {
  for (const link of ["8", "70", "null"]) {
    const sb = await cloudLanding(link as unknown as number);
    try {
      const before = await state(sb.work);
      const r = await sb.script("remove-spec.sh", "--marker-only", "7");
      assertEquals(r.code, 22, `${link}: ${r.stderr}`);
      assertStringIncludes(r.stderr, "does not link #7");
      assertEquals(await state(sb.work), before, link);
    } finally {
      await sb.cleanup();
    }
  }
});

Deno.test("usage: --marker-only takes one plain issue number", async () => {
  const sb = await cloudLanding();
  try {
    const before = await state(sb.work);
    for (
      const args of [["--marker-only"], ["--marker-only", "07"], ["--marker-only", "7", "x"], [
        "--marker-only",
        "$(id)",
      ], ["--marker-only", BRANCH]]
    ) {
      assertEquals((await sb.script("remove-spec.sh", ...args)).code, 2, JSON.stringify(args));
    }
    assertEquals(await state(sb.work), before);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("the marker form keeps the shared refusals: off the base, staged work, an edited marker", async () => {
  const sb = await cloudLanding();
  try {
    await Deno.writeTextFile(join(sb.work, "notes.md"), "mine\n");
    await git(sb.work, "add", "notes.md");
    const staged = await sb.script("remove-spec.sh", "--marker-only", "7");
    assertEquals(staged.code, 22, staged.stderr);
    assertStringIncludes(staged.stderr, "already holds staged changes");
    await git(sb.work, "reset", "--quiet");
    await Deno.writeTextFile(
      join(sb.work, ".specnaut/feature.json"),
      '{ "linked_issue": 7, "x": 1 }\n',
    );
    const edited = await sb.script("remove-spec.sh", "--marker-only", "7");
    assertEquals(edited.code, 22, edited.stderr);
    assertStringIncludes(edited.stderr, "feature.json has uncommitted changes");
    await git(sb.work, "checkout", "--quiet", "--", ".");
    await git(sb.work, "switch", "--quiet", "-c", "elsewhere");
    assertStringIncludes(
      (await sb.script("remove-spec.sh", "--marker-only", "7")).stderr,
      "HEAD is not main",
    );
  } finally {
    await sb.cleanup();
  }
});

Deno.test(
  "something staged between the check and the commit is 23: only the marker is restored",
  { ignore: Deno.build.os === "windows" }, // the shim is a bash script named `git`
  async () => {
    const sb = await cloudLanding();
    try {
      const head = await git(sb.work, "rev-parse", "HEAD");
      const r = await sb.scriptWithGit(
        `if [ "$1" = rm ]; then "$REAL_GIT" "$@" || exit; echo x > other.txt; exec "$REAL_GIT" add other.txt; fi
exec "$REAL_GIT" "$@"`,
        "remove-spec.sh",
        "--marker-only",
        "7",
      );
      assertEquals(r.code, 23, r.stderr);
      assertEquals(await git(sb.work, "rev-parse", "HEAD"), head);
      assertEquals(await git(sb.work, "status", "--porcelain"), "A  other.txt");
    } finally {
      await sb.cleanup();
    }
  },
);

Deno.test("a rejected push is 7; the removal commit stays on the local base", async () => {
  const sb = await cloudLanding();
  try {
    await sb.refusePushes();
    const r = await sb.script("remove-spec.sh", "--marker-only", "7");
    assertEquals(r.code, 7, r.stderr);
    assertEquals(
      await git(sb.work, "show", "--name-status", "--format=", "HEAD"),
      "D\t.specnaut/feature.json",
    );
    assertEquals(
      await git(sb.remote, "ls-tree", "--name-only", "main", "--", ".specnaut/feature.json"),
      ".specnaut/feature.json",
    );
  } finally {
    await sb.cleanup();
  }
});
