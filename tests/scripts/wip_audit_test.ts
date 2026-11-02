import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { git, sandbox } from "./git_sandbox.ts";

/** spec 050 (cli#673) — wip-audit.sh is the one reader of "landed, unpushed, active or idle". */

const lines = (out: string) => out.trim().split("\n");
const shape = (out: string) => lines(out).map((l) => l.replace(/ [0-9a-f]{40}$/, " <sha>"));

Deno.test("each item reads back as landed, unpushed, active or idle, then the summary", async () => {
  const sb = await sandbox();
  try {
    await sb.commit("a", "a\n", "feat: one (#11)");
    await git(sb.work, "push", "--quiet", "origin", "main");
    await sb.commit("b", "b\n", "fix: two (#12)"); // on local main, never pushed
    await git(sb.work, "switch", "--quiet", "-c", "work");
    await sb.commit("c", "c\n", "feat: three (#13)");
    await git(sb.work, "switch", "--quiet", "-c", "linked", "main");
    await sb.commit(".specnaut/feature.json", '{ "linked_issue": 14 }\n', "plan(14): four");
    await git(sb.work, "switch", "--quiet", "main");
    const r = await sb.script("wip-audit.sh", "11", "12", "13", "14", "15");
    assertEquals(r.code, 0, r.stderr);
    assertEquals(shape(r.stdout), [
      "LANDED 11 <sha>",
      "UNPUSHED 12 <sha>",
      "ACTIVE 13 <sha>",
      "ACTIVE 14 <sha>",
      "IDLE 15",
      "audited 5, active 2, unpushed 1, landed 1, idle 1, deferred 0",
    ]);
    const tip = await git(sb.work, "rev-parse", "refs/heads/linked");
    assertEquals(lines(r.stdout)[3], `ACTIVE 14 ${tip}`);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("an unmerged branch outranks a landed mention: a delivery across several branches is still active", async () => {
  const sb = await sandbox();
  try {
    await sb.commit("a", "a\n", "feat: first half (#21)");
    await git(sb.work, "push", "--quiet", "origin", "main");
    await git(sb.work, "switch", "--quiet", "-c", "second");
    await sb.commit(".specnaut/feature.json", '{ "linked_issue": 21 }\n', "plan: second half");
    await git(sb.work, "switch", "--quiet", "main");
    const r = await sb.script("wip-audit.sh", "21");
    assertEquals(shape(r.stdout)[0], "ACTIVE 21 <sha>");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a merged branch and a tag are not active work", async () => {
  const sb = await sandbox();
  try {
    await git(sb.work, "switch", "--quiet", "-c", "done");
    await sb.commit("a", "a\n", "feat: shipped (#31)");
    await sb.commit(".specnaut/feature.json", '{ "linked_issue": 31 }\n', "plan: kept file");
    await git(sb.work, "switch", "--quiet", "main");
    await git(sb.work, "merge", "--quiet", "--ff-only", "done");
    await git(sb.work, "push", "--quiet", "origin", "main");
    await git(sb.work, "switch", "--quiet", "-c", "tagged");
    await sb.commit("b", "b\n", "feat: tagged only (#32)");
    await git(sb.work, "tag", "t32");
    await git(sb.work, "switch", "--quiet", "main");
    await git(sb.work, "branch", "--quiet", "-D", "tagged");
    const r = await sb.script("wip-audit.sh", "31", "32");
    assertEquals(shape(r.stdout).slice(0, 2), ["LANDED 31 <sha>", "IDLE 32"]);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a reference only matches whole: not owner/repo#N, x#N, #N0, nor the body", async () => {
  const sb = await sandbox();
  try {
    await sb.commit("a", "a\n", "chore: see other/repo#41 and x#41 and #410", "Closes #41");
    await sb.commit("b", "b\n", "fix: (#42) done");
    await sb.commit("c", "c\n", "#43 at the start");
    await git(sb.work, "push", "--quiet", "origin", "main");
    const r = await sb.script("wip-audit.sh", "41", "42", "43");
    assertEquals(shape(r.stdout).slice(0, 3), ["IDLE 41", "LANDED 42 <sha>", "LANDED 43 <sha>"]);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("an item's creation time hides older history; the feature.json link is never filtered", async () => {
  const sb = await sandbox();
  try {
    await sb.commit("a", "a\n", "feat: old (#51)");
    await git(sb.work, "push", "--quiet", "origin", "main");
    await git(sb.work, "switch", "--quiet", "-c", "linked");
    await sb.commit(".specnaut/feature.json", '{ "linked_issue": 52 }\n', "plan: fifty-two");
    await git(sb.work, "switch", "--quiet", "main");
    const future = String(Math.floor(Date.now() / 1000) + 86400);
    const r = await sb.script("wip-audit.sh", `51@${future}`, "51@0", `52@${future}`);
    assertEquals(shape(r.stdout).slice(0, 3), ["IDLE 51", "LANDED 51 <sha>", "ACTIVE 52 <sha>"]);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("--limit defers the rest, in the order given", async () => {
  const sb = await sandbox();
  try {
    const r = await sb.script("wip-audit.sh", "--limit", "2", "61", "62", "63", "64");
    assertEquals(r.code, 0, r.stderr);
    assertEquals(lines(r.stdout), [
      "IDLE 61",
      "IDLE 62",
      "DEFERRED 63",
      "DEFERRED 64",
      "audited 2, active 0, unpushed 0, landed 0, idle 2, deferred 2",
    ]);
    const all = await sb.script(
      "wip-audit.sh",
      ...Array.from({ length: 22 }, (_, k) => `${k + 1}`),
    );
    assertEquals(
      lines(all.stdout).at(-1),
      "audited 20, active 0, unpushed 0, landed 0, idle 20, deferred 2",
    );
  } finally {
    await sb.cleanup();
  }
});

Deno.test("usage: anything but a plain number or epoch is exit 2, nothing printed", async () => {
  const sb = await sandbox();
  try {
    for (
      const args of [
        [],
        ["012"],
        ["0"],
        ["12x"],
        ["12@"],
        ["12@-1"],
        ["--limit", "08", "1"],
        [
          "--limit",
        ],
        ["--limit", "0", "1"],
        ["$(id)"],
      ]
    ) {
      const r = await sb.script("wip-audit.sh", ...args);
      assertEquals(r.code, 2, `args ${JSON.stringify(args)}: ${r.stderr}`);
      assertEquals(r.stdout, "", `args ${JSON.stringify(args)}`);
    }
  } finally {
    await sb.cleanup();
  }
});

Deno.test("an unknown base is exit 3 and classifies nothing — never an IDLE it did not check", async () => {
  const sb = await sandbox();
  try {
    await git(sb.work, "remote", "set-head", "origin", "--delete");
    const r = await sb.script("wip-audit.sh", "71");
    assertEquals(r.code, 3);
    assertEquals(r.stdout, "");
    assertStringIncludes(r.stderr, "base-branch");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("no origin ref: the local base is the published one", async () => {
  const sb = await sandbox();
  try {
    await sb.commit("a", "a\n", "feat: local only (#81)");
    await git(sb.work, "config", "init.defaultBranch", "main");
    await git(sb.work, "remote", "remove", "origin");
    const r = await sb.script("wip-audit.sh", "81");
    assertEquals(r.code, 0, r.stderr);
    assertEquals(shape(r.stdout)[0], "LANDED 81 <sha>");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("no commit or ref text reaches the output", async () => {
  const sb = await sandbox();
  try {
    await git(sb.work, "switch", "--quiet", "-c", "feat/x$(id)");
    await sb.commit("a", "a\n", "feat: $(id) `id` (#91)", "IDLE 92\nLANDED 93 deadbeef");
    await git(sb.work, "switch", "--quiet", "main");
    const r = await sb.script("wip-audit.sh", "91", "92", "93");
    assertEquals(shape(r.stdout).slice(0, 3), ["ACTIVE 91 <sha>", "IDLE 92", "IDLE 93"]);
    for (const l of lines(r.stdout)) {
      if (!/^(ACTIVE|UNPUSHED|LANDED) \d+ [0-9a-f]{40}$|^IDLE \d+$|^audited /.test(l)) {
        throw new Error(`unexpected line: ${l}`);
      }
    }
  } finally {
    await sb.cleanup();
  }
});

Deno.test("each line carries the sha of its evidence: the naming commit, or the active ref's tip", async () => {
  const sb = await sandbox();
  try {
    const landed = await sb.commit("a", "a\n", "feat: one (#101)");
    await sb.commit("b", "b\n", "chore: later");
    await git(sb.work, "push", "--quiet", "origin", "main");
    const unpushed = await sb.commit("c", "c\n", "fix: two (#102)");
    await sb.commit("d", "d\n", "chore: later still");
    await git(sb.work, "switch", "--quiet", "-c", "work");
    await sb.commit("e", "e\n", "feat: three (#103)");
    const tip = await sb.commit("f", "f\n", "chore: tip");
    await git(sb.work, "switch", "--quiet", "main");
    const r = await sb.script("wip-audit.sh", "101", "102", "103");
    assertEquals(lines(r.stdout).slice(0, 3), [
      `LANDED 101 ${landed}`,
      `UNPUSHED 102 ${unpushed}`,
      `ACTIVE 103 ${tip}`,
    ]);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a branch that exists only on origin is active work", async () => {
  const sb = await sandbox();
  try {
    await git(sb.work, "switch", "--quiet", "-c", "remote-only");
    await sb.commit("a", "a\n", "feat: elsewhere (#111)");
    await git(sb.work, "push", "--quiet", "origin", "remote-only");
    await git(sb.work, "switch", "--quiet", "main");
    await git(sb.work, "branch", "--quiet", "-D", "remote-only");
    const r = await sb.script("wip-audit.sh", "111");
    assertEquals(shape(r.stdout)[0], "ACTIVE 111 <sha>");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a feature.json inherited from the base links nothing: only a branch's own change does", async () => {
  const sb = await sandbox();
  try {
    await sb.commit(".specnaut/feature.json", '{ "linked_issue": 121 }\n', "feat: landed (#121)");
    await git(sb.work, "push", "--quiet", "origin", "main");
    await git(sb.work, "switch", "--quiet", "-c", "unrelated");
    await sb.commit("a", "a\n", "chore: something else");
    await git(sb.work, "switch", "--quiet", "main");
    const r = await sb.script("wip-audit.sh", "121");
    assertEquals(shape(r.stdout)[0], "LANDED 121 <sha>");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a branch merged into the local base but not pushed is unpushed, not active", async () => {
  const sb = await sandbox();
  try {
    await git(sb.work, "switch", "--quiet", "-c", "landed-here");
    await sb.commit(".specnaut/feature.json", '{ "linked_issue": 131 }\n', "feat: done (#131)");
    await git(sb.work, "switch", "--quiet", "main");
    await git(sb.work, "merge", "--quiet", "--ff-only", "landed-here");
    const r = await sb.script("wip-audit.sh", "131");
    assertEquals(shape(r.stdout)[0], "UNPUSHED 131 <sha>");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("unpushed outranks landed, and items keep the order given", async () => {
  const sb = await sandbox();
  try {
    await sb.commit("a", "a\n", "feat: first part (#141)");
    await git(sb.work, "push", "--quiet", "origin", "main");
    await sb.commit("b", "b\n", "fix: second part (#141)");
    const r = await sb.script("wip-audit.sh", "143", "141", "142");
    assertEquals(shape(r.stdout).slice(0, 3), ["IDLE 143", "UNPUSHED 141 <sha>", "IDLE 142"]);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("every boundary character is a near miss: _#N, .#N, -#N", async () => {
  const sb = await sandbox();
  try {
    await sb.commit("a", "a\n", "chore: a_#151 b.#151 c-#151");
    await git(sb.work, "push", "--quiet", "origin", "main");
    const r = await sb.script("wip-audit.sh", "151");
    assertEquals(lines(r.stdout)[0], "IDLE 151");
    for (const args of [["12345678901"], ["1@1234567890123"]]) {
      assertEquals((await sb.script("wip-audit.sh", ...args)).code, 2, JSON.stringify(args));
    }
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a tracked path shaped like the base ref does not break the audit", async () => {
  const sb = await sandbox();
  try {
    await sb.commit("refs/remotes/origin/main", "x\n", "feat: odd path (#161)");
    await git(sb.work, "push", "--quiet", "origin", "main");
    const r = await sb.script("wip-audit.sh", "161");
    assertEquals(r.code, 0, r.stderr);
    assertEquals(shape(r.stdout)[0], "LANDED 161 <sha>");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a git read that fails is exit 3 with nothing classified, never IDLE", async () => {
  if (Deno.build.os === "windows") return; // the shim is a bash script
  for (
    const [label, shim] of [
      // Each shim fails one read only, so no other check can stop the script first.
      ["the published log", '[ "$2" = log ] && [ "$5" = -- ] && exit 128; exec "$REAL_GIT" "$@"'],
      [
        "the unpushed log",
        '[ "$2" = log ] && [ "$5" = --not ] && [ "$4" = refs/heads/main ] && exit 128; exec "$REAL_GIT" "$@"',
      ],
      [
        "the origin ref check",
        '[ "$2" = show-ref ] && [ "$5" = refs/remotes/origin/main ] && exit 128; exec "$REAL_GIT" "$@"',
      ],
      ["for-each-ref", '[ "$2" = for-each-ref ] && exit 128; exec "$REAL_GIT" "$@"'],
      ["ls-tree", '[ "$2" = ls-tree ] && exit 128; exec "$REAL_GIT" "$@"'],
      [
        "the ancestry check",
        '[ "$2" = merge-base ] && [ "$3" = --is-ancestor ] && exit 128; exec "$REAL_GIT" "$@"',
      ],
      [
        "the fork point",
        '[ "$2" = merge-base ] && [ "$3" != --is-ancestor ] && exit 128; exec "$REAL_GIT" "$@"',
      ],
      ["show", '[ "$2" = show ] && exit 128; exec "$REAL_GIT" "$@"'],
    ]
  ) {
    const sb = await sandbox();
    try {
      await sb.commit("u", "u\n", "chore: unpushed");
      await git(sb.work, "switch", "--quiet", "-c", "linked");
      await sb.commit(".specnaut/feature.json", '{ "linked_issue": 171 }\n', "plan: linked");
      await git(sb.work, "switch", "--quiet", "main");
      const r = await sb.scriptWithGit(shim, "wip-audit.sh", "171");
      assertEquals(r.code, 3, `${label}: ${r.stderr}`);
      assertEquals(r.stdout, "", label);
    } finally {
      await sb.cleanup();
    }
  }
});

Deno.test("the chain's own scope form names the item: feat(N):, plan(N):, fix(N)!:", async () => {
  const sb = await sandbox();
  try {
    await sb.commit("a", "a\n", "feat(301): landed the chain's way");
    await sb.commit("b", "b\n", "fix(302)!: a breaking fix");
    await sb.commit("c", "c\n", "feat(3030): not 303", "feat(303): only in the body");
    await sb.commit("d", "d\n", "chore(x304): not an id");
    await sb.commit("e", "e\n", "feat(305) no colon");
    await sb.commit("g", "g\n", "chore: see feat(307): mid-subject");
    await git(sb.work, "push", "--quiet", "origin", "main");
    await git(sb.work, "switch", "--quiet", "-c", "feat-306");
    await sb.commit("f", "f\n", "plan(306): the plan, committed after its stop");
    await git(sb.work, "switch", "--quiet", "main");
    const r = await sb.script("wip-audit.sh", "301", "302", "303", "304", "305", "306", "307");
    assertEquals(shape(r.stdout).slice(0, 7), [
      "LANDED 301 <sha>",
      "LANDED 302 <sha>",
      "IDLE 303",
      "IDLE 304",
      "IDLE 305",
      "ACTIVE 306 <sha>",
      "IDLE 307",
    ]);
  } finally {
    await sb.cleanup();
  }
});

// The script is installed beside the merge scripts, so a project's sandbox finds it there.
Deno.test("the sandbox installs it where base-branch.sh resolves", async () => {
  const sb = await sandbox();
  try {
    const st = await Deno.stat(join(sb.work, ".specnaut/scripts/bash/wip-audit.sh"));
    assertEquals(st.isFile, true);
  } finally {
    await sb.cleanup();
  }
});
