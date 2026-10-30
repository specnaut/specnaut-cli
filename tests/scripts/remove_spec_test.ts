import { assertEquals, assertNotEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { git } from "./git_sandbox.ts";
import { BRANCH, files, shipped, state } from "./remove_spec_fixture.ts";

/** spec 042 — remove-spec.sh removes one shipped feature directory, and nothing else. */

Deno.test("it removes the directory and feature.json in one commit carrying the item id, pushed", async () => {
  const sb = await shipped();
  try {
    // A name git quotes in its listings (core.quotePath) is still a deletion under the directory.
    await sb.commit(`.specnaut/specs/${BRANCH}/café.md`, "x\n", "docs(7): x");
    const r = await sb.script("remove-spec.sh", BRANCH);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(
      await git(sb.remote, "log", "-1", "--format=%s", "main"),
      "chore(7): remove the spec directory for the shipped feature",
    );
    assertEquals(
      (await git(
        sb.work,
        "-c",
        "core.quotePath=false",
        "show",
        "--name-status",
        "--format=",
        "HEAD",
      ))
        .split("\n").sort(),
      [
        "D\t.specnaut/feature.json",
        `D\t.specnaut/specs/${BRANCH}/café.md`,
        `D\t.specnaut/specs/${BRANCH}/plan.md`,
      ],
    );
  } finally {
    await sb.cleanup();
  }
});

Deno.test("it takes exactly one branch name; anything else is usage, and nothing runs", async () => {
  const sb = await shipped();
  try {
    const before = await state(sb.work);
    for (const args of [[], [BRANCH, BRANCH], ["--exec=x"], ["feat/x"], ["../x"], [""]]) {
      assertEquals((await sb.script("remove-spec.sh", ...args)).code, 2, JSON.stringify(args));
    }
    assertEquals(await state(sb.work), before);
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
      const before = await state(sb.work);
      const tree = await files(join(sb.work, ".specnaut/specs"));
      const src = await files(join(sb.work, "src"));
      const r = await sb.script("remove-spec.sh", BRANCH);
      assertEquals(r.code, 22, `${dir}: ${r.stderr}`);
      assertEquals(await state(sb.work), before, `${dir}: something changed`);
      // The refusal is the point: the spec tree, and what a traversal aims at, are still there.
      assertEquals(
        await files(join(sb.work, ".specnaut/specs")),
        tree,
        `${dir}: the spec tree moved`,
      );
      assertEquals(await files(join(sb.work, "src")), src, `${dir}: src moved`);
    } finally {
      await sb.cleanup();
    }
  }
});

Deno.test("a stale feature.json naming another feature than the branch that landed is skipped", async () => {
  const sb = await shipped();
  try {
    const before = await state(sb.work);
    const r = await sb.script("remove-spec.sh", "008-other");
    assertEquals(r.code, 22, r.stderr);
    assertStringIncludes(r.stderr, "not the spec of 008-other");
    assertEquals(await state(sb.work), before);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("work already staged, or edits under the directory, are skipped and left as they were", async () => {
  const sb = await shipped();
  try {
    await Deno.writeTextFile(join(sb.work, "notes.md"), "mine\n");
    await git(sb.work, "add", "notes.md");
    const before = await state(sb.work);
    const r = await sb.script("remove-spec.sh", BRANCH);
    assertEquals(r.code, 22, r.stderr);
    assertStringIncludes(r.stderr, "already holds staged changes");
    assertEquals(await state(sb.work), before, "the staged work or the spec directory moved");
    await git(sb.work, "reset", "--quiet");
    await Deno.writeTextFile(join(sb.work, `.specnaut/specs/${BRANCH}/plan.md`), "edited\n");
    const edited = await sb.script("remove-spec.sh", BRANCH);
    assertEquals(edited.code, 22, edited.stderr);
    assertStringIncludes(edited.stderr, "uncommitted changes");
    assertEquals(
      await Deno.readTextFile(join(sb.work, `.specnaut/specs/${BRANCH}/plan.md`)),
      "edited\n",
    );
    await git(sb.work, "checkout", "--quiet", "--", ".");
    await git(sb.work, "rm", "--quiet", "--cached", ".specnaut/feature.json");
    await git(sb.work, "commit", "--quiet", "-m", "untrack the pointer");
    const untracked = await sb.script("remove-spec.sh", BRANCH);
    assertEquals(untracked.code, 22, untracked.stderr);
    assertStringIncludes(untracked.stderr, "feature.json is not tracked");
  } finally {
    await sb.cleanup();
  }
});

Deno.test(
  "something staged between the check and the commit is 23: only its own paths are restored",
  {
    // The shim is a bash script named `git` on PATH; Windows resolves `git.exe` first.
    ignore: Deno.build.os === "windows",
  },
  async () => {
    const sb = await shipped();
    try {
      const head = await git(sb.work, "rev-parse", "HEAD");
      // A concurrent writer: it stages its own file right after the script's `git rm`.
      const r = await sb.scriptWithGit(
        `if [ "$1" = rm ]; then "$REAL_GIT" "$@" || exit; echo x > other.txt; exec "$REAL_GIT" add other.txt; fi
exec "$REAL_GIT" "$@"`,
        "remove-spec.sh",
        BRANCH,
      );
      assertEquals(r.code, 23, r.stderr);
      assertStringIncludes(r.stderr, "held 'other.txt'");
      assertEquals(await git(sb.work, "rev-parse", "HEAD"), head, "a commit was made");
      assertEquals(await git(sb.work, "status", "--porcelain"), "A  other.txt");
    } finally {
      await sb.cleanup();
    }
  },
);

Deno.test("a rejected push is 7, says so, and the removal commit stays local", async () => {
  const sb = await shipped();
  try {
    await sb.refusePushes();
    const r = await sb.script("remove-spec.sh", BRANCH);
    assertEquals(r.code, 7, r.stderr);
    assertStringIncludes(
      r.stderr,
      "remove-spec: the push was rejected — the commit stays on the local main",
    );
    assertNotEquals(
      await git(sb.work, "rev-parse", "HEAD"),
      await git(sb.remote, "rev-parse", "main"),
    );
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a directory in no commit, and a run off the base, are skipped with the reason", async () => {
  const fresh = await shipped(".specnaut/specs/009-fresh");
  try {
    await Deno.mkdir(join(fresh.work, ".specnaut/specs/009-fresh"), { recursive: true });
    await Deno.writeTextFile(join(fresh.work, ".specnaut/specs/009-fresh/plan.md"), "x\n");
    const r = await fresh.script("remove-spec.sh", "009-fresh");
    assertEquals(r.code, 22);
    assertStringIncludes(r.stderr, "the only copy");
    assertEquals(await files(join(fresh.work, ".specnaut/specs/009-fresh")), ["plan.md:x\n"]);
  } finally {
    await fresh.cleanup();
  }
  const off = await shipped();
  try {
    await git(off.work, "switch", "--quiet", "-c", "elsewhere");
    const r = await off.script("remove-spec.sh", BRANCH);
    assertEquals(r.code, 22);
    assertStringIncludes(r.stderr, "HEAD is not main");
  } finally {
    await off.cleanup();
  }
});
