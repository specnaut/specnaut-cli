import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { git, sandbox } from "./git_sandbox.ts";

/** spec 042 — remove-spec.sh removes one shipped feature directory, and nothing else. */

async function shipped(featureDir = ".specnaut/specs/007-feature") {
  const sb = await sandbox();
  await sb.commit(".specnaut/specs/007-feature/plan.md", "# plan\n", "plan(7): x");
  await sb.commit("src/app.ts", "export {};\n", "feat(7): x");
  await sb.commit(
    ".specnaut/feature.json",
    JSON.stringify({ feature_directory: featureDir, linked_issue: 7 }) + "\n",
    "chore: feature pointer",
  );
  await git(sb.work, "push", "--quiet", "origin", "main");
  return sb;
}

Deno.test("it removes the directory and feature.json in one commit carrying the item id, pushed", async () => {
  const sb = await shipped();
  try {
    const r = await sb.script("remove-spec.sh");
    assertEquals(r.code, 0, r.stderr);
    assertEquals(
      await git(sb.remote, "log", "-1", "--format=%s", "main"),
      "chore(7): remove the spec directory for the shipped feature",
    );
    assertEquals(
      (await git(sb.work, "show", "--name-status", "--format=", "HEAD")).split("\n").sort(),
      ["D\t.specnaut/feature.json", "D\t.specnaut/specs/007-feature/plan.md"],
    );
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a feature_directory that is not one feature directory is refused, and nothing changes", async () => {
  for (
    const dir of [
      ".",
      "src",
      ".specnaut/specs",
      ".specnaut/specs/../../src",
      "../x",
      "/etc",
      ".specnaut/specs/a/b",
    ]
  ) {
    const sb = await shipped(dir);
    try {
      const head = await git(sb.work, "rev-parse", "HEAD");
      const r = await sb.script("remove-spec.sh");
      assertEquals(r.code, 22, `${dir}: ${r.stderr}`);
      assertEquals(await git(sb.work, "rev-parse", "HEAD"), head, `${dir}: a commit was made`);
      assertEquals(await git(sb.work, "status", "--porcelain"), "", `${dir}: the tree changed`);
    } finally {
      await sb.cleanup();
    }
  }
});

Deno.test("a link, a directory in no commit, and a run off the base are skipped with the reason", async () => {
  // A directory link needs a privilege the Windows runner does not grant; the check is the same.
  if (Deno.build.os !== "windows") {
    const link = await shipped(".specnaut/specs/008-link");
    try {
      await Deno.symlink("../../src", join(link.work, ".specnaut/specs/008-link"), { type: "dir" });
      assertStringIncludes((await link.script("remove-spec.sh")).stderr, "is a link");
    } finally {
      await link.cleanup();
    }
  }
  const fresh = await shipped(".specnaut/specs/009-fresh");
  try {
    await Deno.mkdir(join(fresh.work, ".specnaut/specs/009-fresh"), { recursive: true });
    await Deno.writeTextFile(join(fresh.work, ".specnaut/specs/009-fresh/plan.md"), "x\n");
    const r = await fresh.script("remove-spec.sh");
    assertEquals(r.code, 22);
    assertStringIncludes(r.stderr, "the only copy");
  } finally {
    await fresh.cleanup();
  }
  const off = await shipped();
  try {
    await git(off.work, "switch", "--quiet", "-c", "elsewhere");
    const r = await off.script("remove-spec.sh");
    assertEquals(r.code, 22);
    assertStringIncludes(r.stderr, "HEAD is not main");
  } finally {
    await off.cleanup();
  }
});
