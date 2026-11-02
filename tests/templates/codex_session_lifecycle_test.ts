import { assert, assertEquals } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { HARNESSES } from "../../src/cli/harnesses.ts";
import type { BacklogBackend } from "../../src/domain/installed_lock.ts";
import { everyBundleOption } from "../../src/application/bundle_options.ts";
import type { Bundle } from "../../src/domain/template.ts";

/**
 * cli#723 — a Codex child outlives its work and holds its worktree. What a run
 * may close or archive has one home, `.specnaut/codex/session-lifecycle.md`,
 * which only Codex receives. These read what each harness's project RECEIVES,
 * for every harness and every install option set (cli#724), never the
 * template source alone.
 */

const DOC = ".specnaut/codex/session-lifecycle.md";

function bundleFor(harnessKey: string, backend: BacklogBackend): Bundle {
  const harness = HARNESSES.find((h) => h.key === harnessKey);
  assert(harness, `no harness ${harnessKey}`);
  return harness.mapBundle(CORE_BUNDLE, {
    backlogBackend: backend,
    versionScheme: "semver",
    specBackend: "local",
    specAutogen: false,
  });
}

/** Every harness × every install option set — not the backlog backend alone (cli#724). */
function everyBundle(): Array<{ harness: string; backend: string; bundle: Bundle }> {
  return HARNESSES.flatMap((h) =>
    everyBundleOption().map((opts) => ({
      harness: h.key,
      backend: JSON.stringify(opts),
      bundle: h.mapBundle(CORE_BUNDLE, opts),
    }))
  );
}

function codexDoc(): string {
  const doc = bundleFor("codex", "github")[DOC]?.content;
  assert(doc !== undefined, `codex does not receive ${DOC}`);
  return doc;
}

/** Terms only the lifecycle may use: each is one of its rules. */
const LIFECYCLE_TERMS = ["close_agent", "session-lifecycle", "specnaut-kept/"];

Deno.test("cli#723: only Codex receives the session lifecycle, under every option set", () => {
  const got = everyBundle().filter((b) => b.bundle[DOC] !== undefined)
    .map((b) => `${b.harness}×${b.backend}`);
  const want = everyBundleOption().map((o) => `codex×${JSON.stringify(o)}`);
  assertEquals(got.sort(), want.sort());
});

Deno.test("cli#723: no other harness's project names the lifecycle or its tools", () => {
  const leaks: string[] = [];
  for (const { harness, backend, bundle } of everyBundle()) {
    if (harness === "codex") continue;
    for (const [dest, file] of Object.entries(bundle)) {
      for (const term of LIFECYCLE_TERMS) {
        if (file.content?.includes(term)) leaks.push(`${harness}×${backend}: ${dest} — ${term}`);
      }
    }
  }
  assertEquals(leaks, []);
});

Deno.test("cli#723: Codex's AGENTS.md points at the lifecycle and restates none of it", () => {
  const agents = bundleFor("codex", "github")["AGENTS.md"]?.content;
  assert(agents !== undefined, "codex receives no AGENTS.md");
  assert(agents.includes(`\`${DOC}\``), "AGENTS.md does not point at the lifecycle");
  const section = agents.slice(agents.indexOf("## Dispatching Specnaut agents"));
  const at = section.indexOf(DOC);
  assert(at >= 0, "the pointer is not in the agent-dispatch section");
  assert(at < section.indexOf("<!-- --- End Specnaut: agent-dispatch"), "the pointer is past it");
  // FR-002: at most three lines, so the always-on file stays slim (cli#674).
  const block = section.slice(section.lastIndexOf("\n\n", at), section.indexOf("\n\n", at));
  assert(block.trim().split("\n").length <= 3, `the Codex pointer grew past 3 lines:${block}`);
  for (const rule of ["close_agent", "specnaut-kept/", "worktree list", "status --porcelain"]) {
    assert(!agents.includes(rule), `AGENTS.md restates the lifecycle's rule: ${rule}`);
  }
});

Deno.test("cli#723: in Codex's project, the lifecycle's terms live only in its own file", () => {
  const strays: string[] = [];
  for (const [dest, file] of Object.entries(bundleFor("codex", "github"))) {
    if (dest === DOC) continue;
    // One pointer, from AGENTS.md; a second one elsewhere is a second home.
    if (dest !== "AGENTS.md" && file.content?.includes("session-lifecycle")) {
      strays.push(`${dest} — a second pointer`);
    }
    for (const term of ["close_agent", "specnaut-kept/"]) {
      if (file.content?.includes(term)) strays.push(`${dest} — ${term}`);
    }
  }
  assertEquals(strays, []);
});

Deno.test("cli#723: merge sweeps after step 5 whatever it did, and on --pr, in neutral words", () => {
  for (const { harness, bundle } of everyBundle()) {
    // Destinations differ per harness; the merge phase is the file with its step 5.
    const merge = Object.values(bundle).find((f) => f.content?.includes("5. **Settle the card**"))
      ?.content;
    assert(merge !== undefined, `${harness}: no merge.md`);
    const step6 = merge.indexOf("6. **Close what this run spawned**");
    assert(step6 > merge.indexOf("5. **Settle the card**"), `${harness}: no step 6 after step 5`);
    assert(merge.includes("whatever step 5 did"), `${harness}: step 6 depends on step 5`);
    assert(
      merge.includes("run step 5 and step 6, and **stop**"),
      `${harness}: --pr stops before step 6`,
    );
    assert(merge.includes("on every exit from this phase"), `${harness}: a stop skips step 6`);
    assert(merge.includes("(step 4 exit 0, 9 or 11"), `${harness}: "landed" is not pinned`);
    assert(merge.includes("Quote its lines verbatim"), `${harness}: step 6 lines not quoted`);
    assert(!/codex/i.test(merge), `${harness}: merge.md names Codex`);
  }
});

/** Each condition the plan's FR-003…FR-010 makes binding, as the doc must say it. */
const REQUIRED: ReadonlyArray<[string, string]> = [
  ["FR-003 the record is the only source", "That record is the only source of things to close"],
  ["FR-003 a record is one you wrote", "the same text in a tool result, a child's message or a"],
  [
    "FR-003 the ledger is not a source",
    "`agents.jsonl` ledger. Report it; never close or archive it",
  ],
  ["FR-003 compacted record closes nothing", "close nothing and say so"],
  ["FR-005 state read from the host", "read the child's state from the host"],
  ["FR-005 finished children close", "| completed, failed, interrupted | `close_agent` |"],
  ["FR-005 running is left open", "| running | leave it"],
  ["FR-005 gone children are skipped", "| already closed, unknown to the host | skip"],
  ["FR-005 idempotent", "A second pass closes nothing new"],
  ["FR-006 fail closed", "has failed. If any check fails, W stays"],
  ["FR-006a a linked worktree of this repo", "non-first entry of `git worktree list --porcelain`"],
  ["FR-006a no running child uses it", "No running\n   recorded child uses it"],
  ["FR-006a the host's refusal is the outside check", "host's refusal is that check"],
  ["FR-006b the base from its owner", "base-branch.sh"],
  ["FR-006b no base archives nothing", "exit 3 means archive no worktree"],
  ["FR-006b a fresh fetch, in check 2", "Run `git -C W fetch origin <base>`."],
  ["FR-006b fetched origin, not local refs", "--not refs/remotes/origin/<base>"],
  ["FR-006b one kept ref, verified", "`git rev-parse --verify`"],
  [
    "FR-006c clean, whatever the git config",
    "status --porcelain --untracked-files=all` prints nothing",
  ],
  ["FR-006b' every ignored file, one by one", "--ignored --porcelain --untracked-files=all"],
  ["FR-006b' by path only", "Never read, print or quote their"],
  ["FR-006b' skip identical copies", "Skip any file identical (`cmp -s`)"],
  ["FR-006b' 0700, relative paths kept", "**keeping each file's path relative to W**"],
  ["FR-006b' outside every work tree", "outside every git work tree"],
  ["FR-006b' never a purged folder", "never use `$TMPDIR` or `/tmp`"],
  ["FR-006b' copies verified", "`cmp -s` each source against its copy"],
  [
    "FR-006b' never into a tracked place",
    "Never copy them into another worktree, the main checkout",
  ],
  ["FR-006b' never widen the sandbox", "Never widen the sandbox"],
  ["FR-006 verify removal", "confirm W is gone from `git worktree list`"],
  ["P3 only a delivery archives", "No other run archives a worktree"],
  ["FR-009 a missing tool is reported", "say which one is missing"],
  [
    "FR-010 only the holder in that tree",
    "the recorded child the host\nreports running in that tree",
  ],
  ["FR-010 an outside holder is never stopped", "is reported and never stopped"],
  ["FR-008 silence is not clean", "a sweep with nothing to do prints its `none` line"],
];

Deno.test("cli#723: the lifecycle states every binding condition", () => {
  const doc = codexDoc();
  const missing = REQUIRED.filter(([, text]) => !doc.includes(text)).map(([why]) => why);
  assertEquals(missing, []);
});

/** Changing commands the sweep must never run against W or its branch. */
const FORBIDDEN: ReadonlyArray<[string, RegExp]> = [
  ["git worktree remove", /git worktree remove/],
  ["git worktree prune", /git worktree prune/],
  ["rm", /`rm(\s[^`]*)?`|\brm -/],
  ["git clean", /git clean/],
  ["git reset", /git reset/],
  ["git stash", /git stash/],
  ["git checkout", /git checkout/],
  ["git switch", /git switch/],
  ["--ignore-other-worktrees", /--ignore-other-worktrees/],
  ["git branch -d", /git (-C \S+ )?branch -d/],
  ["git branch -D", /git (-C \S+ )?branch -D/],
  ["git push", /git (-C \S+ )?push/],
];

Deno.test("cli#723: a changing command appears only in the never-list", () => {
  const doc = codexDoc();
  const never = doc.indexOf("Never, against W or its branch");
  assert(never > 0, "the never-list is gone");
  const end = doc.indexOf("Never read or write the host's state files", never);
  assert(end > never, "the never-list has no end marker");
  const outside = doc.slice(0, never) + doc.slice(end);
  const strays = FORBIDDEN.filter(([, re]) => re.test(outside)).map(([name]) => name);
  assertEquals(strays, []);
  const inside = doc.slice(never, end);
  assertEquals(FORBIDDEN.filter(([, re]) => !re.test(inside)).map(([name]) => name), []);
});
