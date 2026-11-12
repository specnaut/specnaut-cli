import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { git, run, type Sandbox, sandbox } from "./git_sandbox.ts";

/**
 * cli#760 FR-12 — `epic-status.sh --landed <E>[@<epoch>]` reads which children
 * an epic shipped from the published base, across every delivery of it.
 */

/** A child commit on the current branch, committed at <epoch>. */
async function child(sb: Sandbox, file: string, epoch: number, subject: string, epic = "50") {
  await Deno.writeTextFile(join(sb.work, file), `${file}\n`);
  await git(sb.work, "add", file);
  const r = await run(
    "git",
    ["commit", "--quiet", "-m", subject, "-m", `Epic: #${epic}`],
    sb.work,
    {
      GIT_COMMITTER_DATE: `@${epoch} +0000`,
      GIT_AUTHOR_DATE: `@${epoch} +0000`,
    },
  );
  if (r.code !== 0) throw new Error(r.stderr);
  return await git(sb.work, "rev-parse", "HEAD");
}

const landed = async (sb: Sandbox, ...args: string[]) => {
  const r = await sb.script("epic-status.sh", "--landed", ...args);
  return { code: r.code, lines: r.stdout.trim().split("\n").filter(Boolean), stderr: r.stderr };
};

Deno.test("two deliveries of one epic read back as every landed child, oldest first, no sequence check", async () => {
  const sb = await sandbox();
  try {
    const a = await child(sb, "a", 1_700_000_000, "feat(T01): one (#51)");
    const b = await child(sb, "b", 1_700_000_100, "feat(T02): two (#52)");
    await git(sb.work, "push", "--quiet", "origin", "main");
    // The second delivery carries the ordinals on, and an unrelated epic and a stray commit sit between.
    await child(sb, "x", 1_700_000_150, "feat(T01): other (#61)", "60");
    await sb.commit("y", "y\n", "chore: unrelated (#50)");
    const c = await child(sb, "c", 1_700_000_200, "feat(T04): four (#54)");
    await git(sb.work, "push", "--quiet", "origin", "main");
    const r = await landed(sb, "50");
    assertEquals(r.code, 0, r.stderr);
    assertEquals(r.lines, [`CHILD T01 #51 ${a}`, `CHILD T02 #52 ${b}`, `CHILD T04 #54 ${c}`]);
    // An epoch hides the older delivery; `@0` is the same as none.
    assertEquals((await landed(sb, "50@1700000100")).lines, [
      `CHILD T02 #52 ${b}`,
      `CHILD T04 #54 ${c}`,
    ]);
    assertEquals((await landed(sb, "50@0")).lines, r.lines);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("an epic's number is matched whole: #5 is not #50, and #50 is not #500", async () => {
  const sb = await sandbox();
  try {
    const a = await child(sb, "a", 1_700_000_000, "feat(T01): one (#51)");
    const z = await child(sb, "z", 1_700_000_100, "feat(T01): far (#501)", "500");
    await git(sb.work, "push", "--quiet", "origin", "main");
    assertEquals((await landed(sb, "5")).lines, []);
    assertEquals((await landed(sb, "50")).lines, [`CHILD T01 #51 ${a}`]);
    assertEquals((await landed(sb, "500")).lines, [`CHILD T01 #501 ${z}`]);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("it reads origin's base, else the local one: an unpushed child has not shipped", async () => {
  const sb = await sandbox();
  try {
    const a = await child(sb, "a", 1_700_000_000, "feat(T01): one (#51)");
    await git(sb.work, "push", "--quiet", "origin", "main");
    await child(sb, "b", 1_700_000_100, "feat(T02): two (#52)");
    assertEquals((await landed(sb, "50")).lines, [`CHILD T01 #51 ${a}`]);
    // A tag named like the base cannot shadow it.
    await git(sb.work, "tag", "main", "HEAD~1");
    assertEquals((await landed(sb, "50")).lines, [`CHILD T01 #51 ${a}`]);
    await git(sb.work, "tag", "-d", "main");
    await git(sb.work, "remote", "remove", "origin");
    await git(sb.work, "config", "init.defaultBranch", "main");
    assertEquals((await landed(sb, "50")).lines.length, 2);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("usage: --landed takes one epic number and an optional epoch, else exit 2", async () => {
  const sb = await sandbox();
  try {
    for (
      const args of [
        ["--landed"],
        ["--landed", "050"],
        ["--landed", "5@"],
        ["--landed", "5@x"],
        [
          "--landed",
          "5",
          "6",
        ],
        ["--landed", "5@1234567890123"],
        ["--other", "5"],
      ]
    ) {
      const r = await sb.script("epic-status.sh", ...args);
      assertEquals([r.code, r.stdout], [2, ""], JSON.stringify(args));
    }
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a log that fails is exit 15, nothing printed", async () => {
  if (Deno.build.os === "windows") return; // the shim is a bash script
  const sb = await sandbox();
  try {
    await child(sb, "a", 1_700_000_000, "feat(T01): one (#51)");
    await git(sb.work, "push", "--quiet", "origin", "main");
    const r = await sb.scriptWithGit(
      '[ "$2" = log ] && exit 128; exec "$REAL_GIT" "$@"',
      "epic-status.sh",
      "--landed",
      "50",
    );
    assertEquals([r.code, r.stdout], [15, ""], r.stderr);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a base ref that cannot be read is exit 15, never taken for an absent one", async () => {
  if (Deno.build.os === "windows") return; // the shim is a bash script
  const sb = await sandbox();
  try {
    await child(sb, "a", 1_700_000_000, "feat(T01): one (#51)");
    await git(sb.work, "push", "--quiet", "origin", "main");
    const shim = '[ "$2" = show-ref ] && exit 128; exec "$REAL_GIT" "$@"';
    const r = await sb.scriptWithGit(shim, "epic-status.sh", "--landed", "50");
    assertEquals([r.code, r.stdout], [15, ""], r.stderr);
  } finally {
    await sb.cleanup();
  }
});
