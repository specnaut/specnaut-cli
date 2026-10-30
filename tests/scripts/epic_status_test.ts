import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { git, sandbox } from "./git_sandbox.ts";

/** spec 042 — epic-status.sh is the one reader of the epic commit format. */

async function epicBranch(children: Array<[string, string]>, epic = "50") {
  const sb = await sandbox();
  await git(sb.work, "switch", "--quiet", "-c", "epic");
  for (const [i, [subject, file]] of children.entries()) {
    await sb.commit(file, `${i}\n`, subject, `Epic: #${epic}`);
  }
  return sb;
}

Deno.test("a consistent epic reads back one CHILD per commit, then the EPIC", async () => {
  const sb = await epicBranch([["feat(T01): one (#51)", "a"], ["fix(T02): two (#52)", "b"]]);
  try {
    const r = await sb.script("epic-status.sh");
    assertEquals(r.code, 0, r.stderr);
    const lines = r.stdout.trim().split("\n");
    assertEquals(lines.map((l) => l.split(" ").slice(0, 3).join(" ")), [
      "CHILD T01 #51",
      "CHILD T02 #52",
      "EPIC #50",
    ]);
    assert(/^CHILD T01 #51 [0-9a-f]{40}$/.test(lines[0]));
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a gap, a repeated child, a bad subject and a second epic are each exit 12", async () => {
  for (
    const [label, children, why] of [
      ["gap", [["feat(T01): a (#51)", "a"], ["feat(T03): c (#53)", "c"]], "T02 was expected next"],
      [
        "repeat",
        [["feat(T01): a (#51)", "a"], ["feat(T02): b (#51)", "b"]],
        "child #51 has two commits",
      ],
      ["subject", [["feat(T01): a (#51)", "a"], ["tidy things", "b"]], "is not '<type>(T<NN>)"],
    ] as const
  ) {
    const sb = await epicBranch(children as unknown as Array<[string, string]>);
    try {
      const r = await sb.script("epic-status.sh");
      assertEquals(r.code, 12, `${label}: ${r.stderr}`);
      assertStringIncludes(r.stderr, why, label);
    } finally {
      await sb.cleanup();
    }
  }
  const sb = await epicBranch([["feat(T01): a (#51)", "a"]]);
  try {
    await sb.commit("b", "b\n", "feat(T02): b (#52)", "Epic: #99");
    const r = await sb.script("epic-status.sh");
    assertEquals(r.code, 12);
    assertStringIncludes(r.stderr, "names epic #99, the branch is #50");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("an unfolded fixup is listed, and a branch with no Epic trailer is exit 14", async () => {
  const sb = await epicBranch([["feat(T01): a (#51)", "a"]]);
  try {
    const target = await git(sb.work, "rev-parse", "HEAD");
    await Deno.writeTextFile(`${sb.work}/a`, "fixed\n");
    await git(sb.work, "commit", "--quiet", "-am", "x", `--fixup=${target}`);
    const r = await sb.script("epic-status.sh");
    assertEquals(r.code, 0, r.stderr);
    assert(/^FIXUP [0-9a-f]{40}$/m.test(r.stdout), r.stdout);
  } finally {
    await sb.cleanup();
  }
  const plain = await sandbox();
  try {
    await git(plain.work, "switch", "--quiet", "-c", "feature");
    await plain.commit("x", "x\n", "feat(9): standalone");
    assertEquals((await plain.script("epic-status.sh")).code, 14);
  } finally {
    await plain.cleanup();
  }
});

Deno.test("after the base is fast-forwarded, the range is empty and it reads as no epic (14)", async () => {
  // Why merge.md reads the epic before land-feature.sh: read after, no child is ever closed.
  const sb = await epicBranch([["feat(T01): a (#51)", "a"]]);
  try {
    assertEquals((await sb.script("epic-status.sh")).code, 0);
    await git(sb.work, "switch", "--quiet", "main");
    await git(sb.work, "merge", "--quiet", "--ff-only", "epic");
    const r = await sb.script("epic-status.sh");
    assertEquals(r.code, 14, "after the landing");
    assertEquals(r.stdout, "");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("it takes no argument: the base has one home", async () => {
  const sb = await sandbox();
  try {
    assertEquals((await sb.script("epic-status.sh", "main")).code, 2);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("the worked example in epic-commits.md parses as the doc says", async () => {
  // The format is written for agents in one file and parsed in another; this keeps them one format.
  const doc = await Deno.readTextFile(
    fromFileUrl(
      new URL("../../templates/core/skills/task/phases/epic-commits.md", import.meta.url),
    ),
  );
  const subject = doc.match(/^feat\(T03\): .+ \(#547\)$/m)?.[0];
  assert(subject, "the worked example is gone from epic-commits.md");
  const sb = await epicBranch([["feat(T01): a (#545)", "a"], ["feat(T02): b (#546)", "b"], [
    subject,
    "c",
  ]], "540");
  try {
    const r = await sb.script("epic-status.sh");
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "CHILD T03 #547 ");
    assertStringIncludes(r.stdout, "EPIC #540");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a child commit with no Epic trailer is exit 12, named by sha", async () => {
  const sb = await epicBranch([["feat(T01): a (#51)", "a"]]);
  try {
    const bare = await sb.commit("b", "b\n", "feat(T02): b (#52)");
    const r = await sb.script("epic-status.sh");
    assertEquals(r.code, 12, r.stderr);
    assertStringIncludes(r.stderr, `${bare.slice(0, 12)} has no 'Epic: #<n>' trailer`);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a git log that fails is exit 15 — never read as 'not an epic' (14)", {
  ignore: Deno.build.os === "windows",
}, async () => {
  const sb = await epicBranch([["feat(T01): a (#51)", "a"]]);
  try {
    for (const flag of ["--reverse", "-1"]) {
      const r = await sb.scriptWithGit(
        `[ "$1" = --no-pager ] && [ "$2" = log ] && [[ " $* " == *" ${flag} "* ]] && exit 128\nexec "$REAL_GIT" "$@"`,
        "epic-status.sh",
      );
      assertEquals(r.code, 15, `${flag}: ${r.stderr}`);
      assertStringIncludes(r.stderr, "could not read");
    }
  } finally {
    await sb.cleanup();
  }
});

Deno.test("an empty range while feature.json names an epic is 16: stop, never squash", async () => {
  // A re-run after a rejected push or a --pr merge: the base has moved, the
  // range is empty, and 14 would send the epic down the standalone path.
  const sb = await epicBranch([["feat(T01): a (#51)", "a"]]);
  try {
    await git(sb.work, "switch", "--quiet", "main");
    await git(sb.work, "merge", "--quiet", "--ff-only", "epic");
    await git(sb.work, "switch", "--quiet", "epic");
    const fj = `${sb.work}/.specnaut/feature.json`;
    await Deno.writeTextFile(
      fj,
      '{ "feature_directory": ".specnaut/specs/001-x", "linked_issue": 50 }\n',
    );
    const r = await sb.script("epic-status.sh");
    assertEquals(r.code, 16, r.stderr);
    assertStringIncludes(r.stderr, "#50");
    assertEquals(r.stdout, "");
    // A standalone item's number is in no Epic trailer: still 14.
    await Deno.writeTextFile(
      fj,
      '{ "feature_directory": ".specnaut/specs/001-x", "linked_issue": 77 }\n',
    );
    assertEquals((await sb.script("epic-status.sh")).code, 14);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a tag named like the base does not shadow it: the range is refs/heads/<base>", async () => {
  const sb = await epicBranch([["feat(T01): a (#51)", "a"]]);
  try {
    // A tag `main` on the root commit: `main..HEAD` would read the install commit too.
    await git(sb.work, "tag", "main", "main~1");
    const r = await sb.script("epic-status.sh");
    assertEquals(r.code, 0, r.stderr);
    assertEquals(r.stdout.trim().split("\n").length, 2, r.stdout);
  } finally {
    await sb.cleanup();
  }
});
