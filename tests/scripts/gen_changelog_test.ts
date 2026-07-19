import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  type Classified,
  classifyCommit,
  collapseTrailingIssueRefs,
  formatChangelog,
} from "../../scripts/gen-changelog.ts";

Deno.test("classifyCommit categorises feat:", () => {
  const r = classifyCommit({ hash: "abc", subject: "feat: add antigravity harness" });
  assertEquals(r.category, "feat");
  assertEquals(r.cleanedSubject, "Add antigravity harness");
});

Deno.test("classifyCommit categorises feat(scope):", () => {
  const r = classifyCommit({
    hash: "abc",
    subject: "feat(harness): add 8th target",
  });
  assertEquals(r.category, "feat");
  assertEquals(r.cleanedSubject, "Add 8th target");
});

Deno.test("classifyCommit categorises fix(scope):", () => {
  const r = classifyCommit({
    hash: "abc",
    subject: "fix(install): handle missing tty",
  });
  assertEquals(r.category, "fix");
  assertEquals(r.cleanedSubject, "Handle missing tty");
});

Deno.test("classifyCommit handles breaking-change marker (feat!:)", () => {
  const r = classifyCommit({ hash: "abc", subject: "feat!: rewire ports" });
  assertEquals(r.category, "feat");
  assertEquals(r.cleanedSubject, "Rewire ports");
});

Deno.test("collapseTrailingIssueRefs collapses a double PR reference to the last one", () => {
  // The exact v1.19.0 case: PR title carried the issue (#431), squash appended (#432).
  assertEquals(
    collapseTrailingIssueRefs("surface Claude Artifacts (#431) (#432)"),
    "surface Claude Artifacts (#432)",
  );
});

Deno.test("collapseTrailingIssueRefs collapses a triple reference to the last one", () => {
  assertEquals(
    collapseTrailingIssueRefs("do a thing (#1) (#2) (#3)"),
    "do a thing (#3)",
  );
});

Deno.test("collapseTrailingIssueRefs leaves a single trailing reference untouched", () => {
  assertEquals(
    collapseTrailingIssueRefs("do a thing (#432)"),
    "do a thing (#432)",
  );
});

Deno.test("collapseTrailingIssueRefs leaves a subject with no reference untouched", () => {
  assertEquals(collapseTrailingIssueRefs("do a thing"), "do a thing");
});

Deno.test("classifyCommit collapses the double PR reference in cleanedSubject", () => {
  const r = classifyCommit({
    hash: "abc",
    subject: "feat(specify): surface Claude Artifacts (#431) (#432)",
  });
  assertEquals(r.category, "feat");
  assertEquals(r.cleanedSubject, "Surface Claude Artifacts (#432)");
});

Deno.test("classifyCommit buckets refactor/docs/test/ci/style/perf/build as chore", () => {
  for (const t of ["chore", "refactor", "docs", "test", "ci", "style", "perf", "build"]) {
    const r = classifyCommit({ hash: "abc", subject: `${t}: tweak` });
    assertEquals(r.category, "chore", `expected chore for prefix ${t}`);
  }
});

Deno.test("classifyCommit buckets unknown prefix as chore", () => {
  const r = classifyCommit({ hash: "abc", subject: "wip: something" });
  assertEquals(r.category, "chore");
  assertEquals(r.cleanedSubject, "Something");
});

Deno.test("classifyCommit handles no prefix as chore", () => {
  const r = classifyCommit({ hash: "abc", subject: "merge pr" });
  assertEquals(r.category, "chore");
  assertEquals(r.cleanedSubject, "Merge pr");
});

Deno.test("classifyCommit skips release bump commits", () => {
  const r = classifyCommit({ hash: "abc", subject: "chore: release v0.7.3" });
  assertEquals(r.category, "skip");
});

Deno.test("classifyCommit skips release bump with patch number", () => {
  const r = classifyCommit({ hash: "abc", subject: "chore: release v1.10.42" });
  assertEquals(r.category, "skip");
});

function classified(category: Classified["category"], cleaned: string): Classified {
  return { hash: "abc", subject: "x", category, cleanedSubject: cleaned };
}

Deno.test("formatChangelog with mixed commits emits all three sections", () => {
  const commits: Classified[] = [
    classified("feat", "Add harness"),
    classified("fix", "Net allowlist"),
    classified("chore", "Bump deps"),
  ];
  const md = formatChangelog(commits, { fromTag: "v0.1.0", toTag: "v0.2.0" });
  assertStringIncludes(md, "## What's changed in v0.2.0");
  assertStringIncludes(md, "### Features");
  assertStringIncludes(md, "- Add harness");
  assertStringIncludes(md, "### Bug fixes");
  assertStringIncludes(md, "- Net allowlist");
  assertStringIncludes(md, "### Internal / chores");
  assertStringIncludes(md, "<details>");
  assertStringIncludes(md, "<summary>1 internal change</summary>");
  assertStringIncludes(md, "- Bump deps");
});

Deno.test("formatChangelog pluralises chore summary", () => {
  const commits: Classified[] = [
    classified("chore", "A"),
    classified("chore", "B"),
  ];
  const md = formatChangelog(commits, { fromTag: "v0", toTag: "v1" });
  assertStringIncludes(md, "<summary>2 internal changes</summary>");
});

Deno.test("formatChangelog omits empty sections", () => {
  const commits: Classified[] = [classified("fix", "Only fix")];
  const md = formatChangelog(commits, { fromTag: "v0", toTag: "v1" });
  assertEquals(md.includes("### Features"), false);
  assertEquals(md.includes("### Internal"), false);
  assertStringIncludes(md, "### Bug fixes");
});

Deno.test("formatChangelog with empty commit list emits placeholder", () => {
  const md = formatChangelog([], { fromTag: "v0", toTag: "v1" });
  assertStringIncludes(md, "_No user-facing changes since the previous release._");
});

Deno.test("formatChangelog appends compare URL when fromTag and repoUrl set", () => {
  const md = formatChangelog([classified("feat", "X")], {
    fromTag: "v0",
    toTag: "v1",
    repoUrl: "https://github.com/x/y",
  });
  assertStringIncludes(md, "**Full changelog:** https://github.com/x/y/compare/v0...v1");
});

Deno.test("formatChangelog omits compare URL when fromTag is null", () => {
  const md = formatChangelog([classified("feat", "X")], {
    fromTag: null,
    toTag: "v1",
    repoUrl: "https://github.com/x/y",
  });
  assertEquals(md.includes("Full changelog"), false);
});

import { extractAdoption } from "../../scripts/gen-changelog.ts";

Deno.test("extractAdoption: returns null when no section present", () => {
  const body = "## Summary\n\nfoo\n\n## Tests\n\nbar\n";
  assertEquals(extractAdoption(body), null);
});

Deno.test("extractAdoption: extracts section content up to next H2", () => {
  const body =
    "## Summary\n\nfoo\n\n## Agent adoption\n\nprose here\n\n```prompt\nrun this\n```\n\n## Tests\n\nbar\n";
  const got = extractAdoption(body);
  assertEquals(
    got,
    "prose here\n\n```prompt\nrun this\n```",
  );
});

Deno.test("extractAdoption: extracts trailing section to EOF", () => {
  const body = "## Summary\n\nfoo\n\n## Agent adoption\n\nprose\n\n```prompt\nx\n```\n";
  const got = extractAdoption(body);
  assertEquals(got, "prose\n\n```prompt\nx\n```");
});

Deno.test("extractAdoption: strips html comments inside section", () => {
  const body =
    "## Agent adoption\n\n<!-- Required for feat -->\n\nreal prose\n\n```prompt\np\n```\n";
  const got = extractAdoption(body);
  assertEquals(got, "real prose\n\n```prompt\np\n```");
});

Deno.test("extractAdoption: returns null when section has no prompt block", () => {
  const body = "## Agent adoption\n\njust prose, no fenced block\n\n## Tests\n";
  assertEquals(extractAdoption(body), null);
});

import { extractPrNumber } from "../../scripts/gen-changelog.ts";

Deno.test("extractPrNumber: parses trailing (#NNN)", () => {
  assertEquals(extractPrNumber("Add foo (#252)"), 252);
});

Deno.test("extractPrNumber: returns null when no PR ref", () => {
  assertEquals(extractPrNumber("Add foo"), null);
});

Deno.test("extractPrNumber: ignores mid-subject mentions", () => {
  // "(#X)" only counted when it's at end of subject, after whitespace.
  assertEquals(extractPrNumber("Fixed (#bug) bug (#99)"), 99);
});

Deno.test("formatChangelog: emits Adoption guide section when entries present", () => {
  const commits = [
    {
      hash: "abc1234",
      subject: "Add the thing (#252)",
      category: "feat" as const,
      cleanedSubject: "Add the thing (#252)",
    },
  ];
  const md = formatChangelog(commits, {
    fromTag: "v1.4.0",
    toTag: "v1.5.0",
    adoptionEntries: [
      { prNum: 252, title: "Add the thing", body: "Do X.\n\n```prompt\nrun X\n```" },
    ],
  });
  // Adoption guide section present, with PR header and body.
  if (!md.includes("### Adoption guide")) throw new Error("missing Adoption guide");
  if (!md.includes("**#252 — Add the thing**")) throw new Error("missing PR header");
  if (!md.includes("```prompt\nrun X\n```")) throw new Error("missing prompt block");
});

Deno.test("formatChangelog: omits Adoption guide when entries empty", () => {
  const md = formatChangelog([], {
    fromTag: "v1.4.0",
    toTag: "v1.5.0",
    adoptionEntries: [],
  });
  if (md.includes("### Adoption guide")) throw new Error("should not include Adoption guide");
});

Deno.test("extractAdoption: strips nested/malformed HTML comments completely", () => {
  const body =
    "## Agent adoption\n\n<!-- outer <!-- inner --> still outer -->\n\nreal prose\n\n```prompt\np\n```\n";
  const got = extractAdoption(body);
  // After the loop, no <!-- substring should remain.
  if (got === null) throw new Error("expected non-null");
  if (got.includes("<!--")) throw new Error(`residual <!--: ${got}`);
});

// ---------------------------------------------------------------------------
// Adoption assembly seam (#363) — all hermetic, via an injected fake fetcher.
// ---------------------------------------------------------------------------

import {
  assembleAdoptionEntries,
  type PrBodyFetcher,
  type PrBodyOutcome,
} from "../../scripts/gen-changelog.ts";

/**
 * Build a hermetic `PrBodyFetcher` from a `Map<number, PrBodyOutcome>`.
 * Any PR number not in the map resolves to `{ kind: "absent" }` — the
 * conservative default that must never be mistaken for a `failed` retrieval.
 */
function fakeFetcher(map: Map<number, PrBodyOutcome>): PrBodyFetcher {
  return (prNum: number) => Promise.resolve(map.get(prNum) ?? { kind: "absent" });
}

/** A `feat` `Classified` commit with the given subject (carrying its own PR ref). */
function featCommit(subject: string): Classified {
  return {
    hash: "deadbee",
    subject,
    category: "feat",
    cleanedSubject: subject.charAt(0).toUpperCase() + subject.slice(1),
  };
}

/** A minimal valid `## Agent adoption` PR body for prompt content `p`. */
function adoptionBody(p: string): string {
  return `## Summary\n\nfoo\n\n## Agent adoption\n\nprose\n\n\`\`\`prompt\n${p}\n\`\`\`\n`;
}

Deno.test("assembleAdoptionEntries: retrieved with valid block ⇒ one entry, no failure", async () => {
  const commits: Classified[] = [featCommit("Add the thing (#101)")];
  const map = new Map<number, PrBodyOutcome>([
    [101, { kind: "retrieved", body: adoptionBody("run X") }],
  ]);
  const { entries, failures } = await assembleAdoptionEntries(commits, fakeFetcher(map));
  assertEquals(entries.length, 1);
  assertEquals(entries[0].prNum, 101);
  assertEquals(entries[0].title, "Add the thing");
  assertStringIncludes(entries[0].body, "```prompt\nrun X\n```");
  assertEquals(failures.length, 0);
});

Deno.test("assembleAdoptionEntries: retrieved without a block ⇒ no entry, no failure", async () => {
  const commits: Classified[] = [featCommit("Add a thing (#102)")];
  const map = new Map<number, PrBodyOutcome>([
    [102, { kind: "retrieved", body: "## Summary\n\nno adoption here\n" }],
  ]);
  const { entries, failures } = await assembleAdoptionEntries(commits, fakeFetcher(map));
  assertEquals(entries.length, 0);
  assertEquals(failures.length, 0);
});

Deno.test("assembleAdoptionEntries: absent ⇒ no entry, no failure", async () => {
  const commits: Classified[] = [featCommit("Add a thing (#103)")];
  const map = new Map<number, PrBodyOutcome>([[103, { kind: "absent" }]]);
  const { entries, failures } = await assembleAdoptionEntries(commits, fakeFetcher(map));
  assertEquals(entries.length, 0);
  assertEquals(failures.length, 0);
});

Deno.test("assembleAdoptionEntries: failed ⇒ recorded in failures, no entry", async () => {
  const commits: Classified[] = [featCommit("Add a thing (#104)")];
  const map = new Map<number, PrBodyOutcome>([
    [104, { kind: "failed", reason: "gh: HTTP 401" }],
  ]);
  const { entries, failures } = await assembleAdoptionEntries(commits, fakeFetcher(map));
  assertEquals(entries.length, 0);
  assertEquals(failures.length, 1);
  assertEquals(failures[0].prNum, 104);
  assertStringIncludes(failures[0].reason, "401");
});

Deno.test("assembleAdoptionEntries: feat subject without (#NNN) ⇒ no entry, no failure", async () => {
  const commits: Classified[] = [featCommit("Add a thing with no PR ref")];
  const { entries, failures } = await assembleAdoptionEntries(
    commits,
    fakeFetcher(new Map()),
  );
  assertEquals(entries.length, 0);
  assertEquals(failures.length, 0);
});

Deno.test("assembleAdoptionEntries: non-feat commits are ignored", async () => {
  const commits: Classified[] = [
    { hash: "a", subject: "Fix x (#201)", category: "fix", cleanedSubject: "Fix x (#201)" },
    { hash: "b", subject: "Bump (#202)", category: "chore", cleanedSubject: "Bump (#202)" },
  ];
  // Even though the map has a failed outcome for these PRs, non-feat commits
  // are never fetched, so no failure can be recorded.
  const map = new Map<number, PrBodyOutcome>([
    [201, { kind: "failed", reason: "would-be-error" }],
    [202, { kind: "failed", reason: "would-be-error" }],
  ]);
  const { entries, failures } = await assembleAdoptionEntries(commits, fakeFetcher(map));
  assertEquals(entries.length, 0);
  assertEquals(failures.length, 0);
});

// ---------------------------------------------------------------------------
// US1 — parity: N retrieved valid blocks ⇒ N entries; section byte-identical
// to a golden string; identical whether assembled strict or non-strict (the
// strict flag is a caller-side exit decision, never an assembly-output input).
// ---------------------------------------------------------------------------

Deno.test("C1/SC-001: N feat PRs all retrieved+valid ⇒ N entries in the formatted body", async () => {
  const commits: Classified[] = [
    featCommit("Add alpha (#301)"),
    featCommit("Add beta (#302)"),
    featCommit("Add gamma (#303)"),
  ];
  const map = new Map<number, PrBodyOutcome>([
    [301, { kind: "retrieved", body: adoptionBody("run alpha") }],
    [302, { kind: "retrieved", body: adoptionBody("run beta") }],
    [303, { kind: "retrieved", body: adoptionBody("run gamma") }],
  ]);
  const { entries, failures } = await assembleAdoptionEntries(commits, fakeFetcher(map));
  assertEquals(entries.length, 3);
  assertEquals(failures.length, 0);

  const md = formatChangelog(commits, {
    fromTag: "v1.4.0",
    toTag: "v1.5.0",
    adoptionEntries: entries,
  });
  assertStringIncludes(md, "### Adoption guide");
  assertStringIncludes(md, "**#301 — Add alpha**");
  assertStringIncludes(md, "**#302 — Add beta**");
  assertStringIncludes(md, "**#303 — Add gamma**");
  // Exactly N entry headers.
  assertEquals((md.match(/\*\*#\d+ — /g) ?? []).length, 3);
});

Deno.test("C2/SC-002: adoption section is byte-identical to golden AND strict-independent", async () => {
  const commits: Classified[] = [featCommit("Add the thing (#252)")];
  const map = new Map<number, PrBodyOutcome>([
    [252, { kind: "retrieved", body: adoptionBody("run X") }],
  ]);
  // The assembly seam takes no `strict` input — the same call backs both modes.
  // Run it twice to prove the produced entries (hence the body) are identical.
  const a = await assembleAdoptionEntries(commits, fakeFetcher(map));
  const b = await assembleAdoptionEntries(commits, fakeFetcher(map));

  const opts = { fromTag: "v1.4.0" as const, toTag: "v1.5.0" as const };
  const bodyA = formatChangelog(commits, { ...opts, adoptionEntries: a.entries });
  const bodyB = formatChangelog(commits, { ...opts, adoptionEntries: b.entries });
  assertEquals(bodyA, bodyB, "body must not depend on which run produced the entries");

  // Byte-exact golden of the Adoption guide section.
  const golden = "### Adoption guide\n\n" +
    "These prompts help your AI agent adopt the new features in an existing project. " +
    "Copy them into your harness, or run `@specnaut-expert review-upgrade` to be walked " +
    "through automatically.\n\n" +
    "**#252 — Add the thing**\n\n" +
    "prose\n\n```prompt\nrun X\n```";
  assertStringIncludes(bodyA, golden);
});

// ---------------------------------------------------------------------------
// C4/SC-004 — v1.13.0 regression. The published v1.13.0 body shipped with an
// EMPTY Adoption guide because CI `gh` was unauthenticated and every fetch
// failed. This fixture models the v1.13.0 feat-PR range (real subjects + PR
// numbers from `git log v1.12.0..v1.13.0`) and proves that, with retrieval
// working, the produced guide carries one entry per feat PR that has a valid
// `## Agent adoption` block — i.e. the range that shipped empty now ships
// complete. Hermetic: bodies are inlined, no live `gh`.
// ---------------------------------------------------------------------------

Deno.test("C4/SC-004: v1.13.0 range fixture ⇒ expected adoption entry count", async () => {
  // Real v1.13.0-range feat commits. Of these:
  //  - five carry a (#NNN) ref AND a valid adoption block ⇒ 5 entries;
  //  - #350 is retrieved but carries NO adoption block ⇒ quiet skip;
  //  - the `add cloud backend` feat has NO (#NNN) ⇒ quiet skip.
  const commits: Classified[] = [
    featCommit("Specnaut Cloud funnel — landing CTA + CLI nudges (#361)"),
    featCommit("Native OS keychain for CLI credentials via Deno FFI (#360)"),
    featCommit("Gate-aware clarify phase + `specnaut gate` command (#358)"),
    featCommit("Interactive Specnaut Cloud auth — `specnaut cloud login` (#353)"),
    featCommit("Add /specnaut brainstorm phase — optional step-0 spec discovery (#352)"),
    featCommit("Carry agent model tier into sub-agent TOML reasoning effort (#350)"),
    featCommit("Add `cloud` backend — drive a Specnaut Cloud board from the CLI"),
  ];
  const map = new Map<number, PrBodyOutcome>([
    [361, { kind: "retrieved", body: adoptionBody("adopt funnel") }],
    [360, { kind: "retrieved", body: adoptionBody("adopt keychain") }],
    [358, { kind: "retrieved", body: adoptionBody("adopt gate") }],
    [353, { kind: "retrieved", body: adoptionBody("adopt cloud login") }],
    [352, { kind: "retrieved", body: adoptionBody("adopt brainstorm") }],
    // Retrieved but no adoption section — legitimate quiet skip, not a failure.
    [350, { kind: "retrieved", body: "## Summary\n\ninternal codex plumbing\n" }],
  ]);

  const { entries, failures } = await assembleAdoptionEntries(commits, fakeFetcher(map));
  assertEquals(entries.length, 5, "expected one entry per valid-block feat PR in the range");
  assertEquals(failures.length, 0, "no retrieval failures in a healthy run");

  const md = formatChangelog(commits, {
    fromTag: "v1.12.0",
    toTag: "v1.13.0",
    adoptionEntries: entries,
  });
  assertStringIncludes(md, "### Adoption guide");
  assertEquals((md.match(/\*\*#\d+ — /g) ?? []).length, 5);
});

// ---------------------------------------------------------------------------
// US2 — strict guard. The decision predicate (`failures.length > 0 && strict`)
// is the source of truth; we also exercise the real `Deno.exit(1)` path via a
// subprocess driven by a FORCED failure (a shadowed `gh` that always exits
// non-zero), so the assertion is deterministic — never dependent on network /
// auth state.
// ---------------------------------------------------------------------------

Deno.test("C3/SC-003: strict predicate fires iff a failure is present under strict", async () => {
  const commits: Classified[] = [
    featCommit("Add alpha (#401)"),
    featCommit("Add beta (#402)"),
  ];
  const map = new Map<number, PrBodyOutcome>([
    [401, { kind: "retrieved", body: adoptionBody("run alpha") }],
    [402, { kind: "failed", reason: "gh: HTTP 401 Unauthorized" }],
  ]);
  const { entries, failures } = await assembleAdoptionEntries(commits, fakeFetcher(map));
  // The retrieved one still produces an entry; the failed one is recorded.
  assertEquals(entries.length, 1);
  assertEquals(failures.length, 1);
  // The exact predicate `main()` uses to decide whether to abort.
  assertEquals(failures.length > 0 && true, /* strict */ true);
  assertEquals(failures.length > 0 && false, /* non-strict */ false);
});

Deno.test({
  name:
    "C3/SC-003,SC-005: `--strict` against a forced gh failure exits non-zero and writes no file",
  // Spawns subprocesses (deno + git + a shadowed gh); needs run/read/write/env.
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    const scriptDir = new URL("../../scripts/gen-changelog.ts", import.meta.url).pathname;

    // A throwaway dir holding (a) a `gh` shim that always fails and (b) a
    // self-contained git repo with one known `feat: … (#999)` commit. Building
    // our own repo keeps the test hermetic — it must NOT depend on the outer
    // repo's tags/history (CI checkouts are shallow and lack old tags, which
    // would make `git log <tag>..HEAD` throw before the strict path runs).
    const tmp = await Deno.makeTempDir({ prefix: "genchangelog_strict_" });
    try {
      const ghShim = `${tmp}/gh`;
      await Deno.writeTextFile(ghShim, "#!/bin/sh\necho 'forced gh failure' >&2\nexit 1\n");
      await Deno.chmod(ghShim, 0o755);

      const repo = `${tmp}/repo`;
      await Deno.mkdir(repo);
      const git = async (...args: string[]) => {
        const { success, stderr } = await new Deno.Command("git", {
          args,
          cwd: repo,
          env: { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
          clearEnv: false,
          stdout: "null",
          stderr: "piped",
        }).output();
        if (!success) throw new Error(`git ${args[0]} failed: ${new TextDecoder().decode(stderr)}`);
      };
      await git("init", "-q");
      await git("config", "user.email", "t@t.test");
      await git("config", "user.name", "t");
      await Deno.writeTextFile(`${repo}/a`, "1");
      await git("add", "-A");
      await git("commit", "-q", "-m", "chore: base");
      const baseSha = new TextDecoder()
        .decode(
          (await new Deno.Command("git", { args: ["rev-parse", "HEAD"], cwd: repo }).output())
            .stdout,
        )
        .trim();
      await Deno.writeTextFile(`${repo}/a`, "2");
      await git("add", "-A");
      await git("commit", "-q", "-m", "feat: a thing (#999)");

      const outFile = `${tmp}/release-notes.md`;

      // Prepend the shim dir to PATH so every `gh pr view` resolves to the
      // failing shim (git/deno still resolve from the inherited PATH tail).
      const env: Record<string, string> = {
        PATH: `${tmp}:${Deno.env.get("PATH") ?? ""}`,
      };

      const cmd = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-read",
          "--allow-write",
          "--allow-run",
          "--allow-env",
          scriptDir,
          // baseSha..HEAD contains exactly one `feat: … (#999)` commit, so the
          // shimmed `gh` is invoked and that fetch becomes a `failed` outcome.
          "--from",
          baseSha,
          "--to",
          "v9.9.9-test",
          "--out",
          outFile,
          "--strict",
        ],
        cwd: repo,
        env,
        clearEnv: false,
        stdout: "piped",
        stderr: "piped",
      });
      const { code, stderr } = await cmd.output();

      const stderrText = new TextDecoder().decode(stderr);

      assertEquals(code !== 0, true, "strict run with retrieval failures must exit non-zero");
      // The output file must NOT have been written (exit happens before write).
      assertEquals(await fileExists(outFile), false, "no partial release notes may be written");
      // Guard against a silent pass (empty range ⇒ exit for the wrong reason):
      // the strict per-failure report must name our feat PR, and the strict
      // refusal summary must be present — together they prove the non-zero exit
      // came from the strict path. Cross-platform: the temp repo has no remote,
      // so `gh pr view 999` fails on every OS regardless of the PATH shim (the
      // shim is only resolved on POSIX; Windows falls back to the real `gh`,
      // which fails too — both are the retrieval failure under test).
      assertStringIncludes(stderrText, "#999");
      assertStringIncludes(stderrText, "under --strict");
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
});

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// US3 — legitimate absence stays quiet; only a retrieval failure is loud. A mix
// of `absent`, `retrieved`-without-block, and PR-number-less feat commits must
// produce zero `failures` (so strict would NOT abort); adding one `failed` to
// the same set is the ONLY thing that trips the guard. This proves the original
// bug — collapsing `failed` into `absent` — cannot recur (FR-004/FR-007).
// ---------------------------------------------------------------------------

Deno.test("C5/SC-006: absence + no-block + no-PR-ref ⇒ zero failures (strict would not trip)", async () => {
  const commits: Classified[] = [
    featCommit("Add a (#501)"), // absent
    featCommit("Add b (#502)"), // retrieved, no adoption block
    featCommit("Add c with no PR ref"), // no (#NNN)
  ];
  const map = new Map<number, PrBodyOutcome>([
    [501, { kind: "absent" }],
    [502, { kind: "retrieved", body: "## Summary\n\nno adoption here\n" }],
  ]);
  const { entries, failures } = await assembleAdoptionEntries(commits, fakeFetcher(map));
  assertEquals(entries.length, 0, "no valid blocks ⇒ no entries");
  assertEquals(failures.length, 0, "legitimate absences must never be failures");
  // The strict predicate would NOT abort: no false positive from absences.
  assertEquals(failures.length > 0, false);
});

Deno.test("C5: a single failed outcome amid legitimate absences is the only thing that trips strict", async () => {
  const commits: Classified[] = [
    featCommit("Add a (#601)"), // absent
    featCommit("Add b (#602)"), // retrieved, no block
    featCommit("Add c (#603)"), // FAILED — the one defect
  ];
  const map = new Map<number, PrBodyOutcome>([
    [601, { kind: "absent" }],
    [602, { kind: "retrieved", body: "## Summary\n\nno block\n" }],
    [603, { kind: "failed", reason: "network: ECONNRESET" }],
  ]);
  const { entries, failures } = await assembleAdoptionEntries(commits, fakeFetcher(map));
  assertEquals(entries.length, 0);
  // Exactly one failure — the failed one — never the absences.
  assertEquals(failures.length, 1);
  assertEquals(failures[0].prNum, 603);
  assertStringIncludes(failures[0].reason, "ECONNRESET");
});
