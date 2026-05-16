import { assertEquals, assertStringIncludes } from "@std/assert";
import { type Classified, classifyCommit, formatChangelog } from "../../scripts/gen-changelog.ts";

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
