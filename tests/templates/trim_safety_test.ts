import { assert } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";

/**
 * The sentences a trim may not remove.
 *
 * #562 buys editing headroom by cutting characters out of the longest bundled
 * files. The only automated check on those files was a **size** assertion —
 * and a size assertion is satisfied by deletion. `plugin_sync_test.ts` mirrors
 * a trim rather than catching it; `product-owner.md` had no content assertion
 * at all; `implement.md`'s golden pins the `local` render, which is not the
 * branch being trimmed.
 *
 * So this file exists before the trims do. Every sentence below was named by
 * the plan-stage security audit as one whose removal would weaken behaviour
 * silently — and in each case the block it sits in is the most
 * duplication-shaped part of its file, which is to say the most attractive
 * thing to cut under a character deadline.
 *
 * **Whitespace is normalised before matching, and that is not a convenience.**
 * These sentences are line-wrapped in their source files. Asserting on the raw
 * content would fail on text that is present — and the natural "fix" for such a
 * failure is to shorten the asserted fragment until it stops spanning a line
 * break, which is how a guard quietly becomes a keyword check that a mutilated
 * sentence passes.
 */

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

function entry(category: string, name: string, suffix: string | null): string {
  const found = CORE_BUNDLE.find((e) =>
    e.category === category && e.name === name && (e.suffix ?? null) === suffix
  );
  assert(found, `no bundle entry: ${category}/${name}/${suffix ?? "-"}`);
  return flat(found.content);
}

/** file → the sentences that must survive, with why in the key. */
const MUST_SURVIVE: ReadonlyArray<
  { readonly label: string; readonly body: () => string; readonly sentences: readonly string[] }
> = [
  {
    label: "security-expert.md",
    body: () => entry("agent", "security-expert", null),
    sentences: [
      // The operative half of the secrets rule. The pre-existing assertion
      // covers only the heading clause "never emit a secret value" — these two
      // clauses are what make it actionable.
      "Never the value, not truncated, not partially masked.",
      "Recommend rotation at the issuer, not just deletion.",
      // Without the tiebreak, the summary and the catalogue can disagree with
      // nothing to resolve it.
      "the domain file wins",
      // Removal collapses severity to a lookup table.
      "Severity above is the **default**, before adjustment.",
    ],
  },
  {
    label: "product-owner.md",
    body: () => entry("agent", "product-owner", null),
    sentences: [
      // The only fail-closed gate before a mutation, on an agent holding
      // Write/Edit/Bash.
      "ask the user which is canonical before mutating anything",
      // The in-agent statement of the constitution's bridge constraint —
      // three words, shaped exactly like a stub a trim would sweep.
      "Public API only.",
      // The data-destruction prohibition.
      "Never delete task files",
      // Silent-failure rule: a skipped classification must be visible.
      "classification incomplete",
      // The pre-close gate and its exit-code semantics.
      "cascade-check.sh",
    ],
  },
  {
    label: "implement.md",
    body: () => entry("phase", "task", "implement.md"),
    sentences: [
      // The eval-refusal rule ("leave condition evaluation to the HookExecutor")
      // guarded the extension-hook path, which spec 041 removed whole; the test
      // below asserts the path itself is gone, which is stronger than the rule.
      // Integrity control against a TOCTOU between "reviewed" and "what ships".
      "Freeze the tree.",
      // Secret-exclusion patterns for CONSUMER repositories. Collapsing the
      // per-language rows into the universal set deletes exactly these.
      "*.tfstate",
      "kubeconfig",
    ],
  },
  {
    label: "backlog-frontmatter (split out of product-owner under #562)",
    body: () => entry("skill", "backlog-frontmatter", null),
    sentences: ["mandatory"],
  },
  {
    label: "specnaut-facts (split out of specnaut-guide under #562)",
    body: () => entry("skill", "specnaut-facts", null),
    sentences: ["Specnaut"],
  },
  {
    label: "task/spec-autogen.md",
    body: () => entry("backlog-doc", "task", "spec-autogen.md"),
    sentences: [
      "**Never fatal to task creation**",
    ],
  },
  {
    // `board/SKILL.md` until cli#683, when the backlog verbs' bodies moved to
    // `task/backlog.md` and the rule moved with them — so the assertion moved
    // too, rather than being deleted for failing where the text no longer is.
    label: "task/backlog.md",
    body: () => entry("backlog-doc", "task", "backlog.md"),
    sentences: [
      // The skill's scope-confinement rule, on an agent holding forge
      // credentials. It sits in the file's tail — the first thing a truncation
      // would eat.
      "The user asks about another project's backlog — these verbs are wired to this project only.",
    ],
  },
];

for (const { label, body, sentences } of MUST_SURVIVE) {
  Deno.test(`${label} keeps every sentence a trim may not remove`, () => {
    const content = body();
    for (const sentence of sentences) {
      assert(
        content.includes(flat(sentence)),
        `${label} no longer contains:\n  ${flat(sentence)}\n` +
          `If this was removed deliberately, it is not a trim — see plan 028 FR-008.`,
      );
    }
  });
}

Deno.test("implement.md runs no command read from a contributor-writable file (spec 041)", () => {
  const content = entry("phase", "task", "implement.md");
  for (const shape of ["EXECUTE_COMMAND", "extensions.yml"]) {
    assert(!content.includes(shape), `implement.md still carries ${shape}`);
  }
});

/**
 * #678 retired the alert-triage mode, and with it the `gh api` allowlist that
 * was the ENTIRE limit on security-expert's unconditional `Bash` grant. The two
 * had to leave together: an allowlist removed while the grant stays is an
 * arbitrary shell on the seat that reads every diff. The sentences that pinned
 * the allowlist (and "Do NOT auto-close the alert") moved here as this
 * absence assertion rather than being deleted for failing where the text no
 * longer is.
 */
Deno.test("security-expert lost its Bash grant with the allowlist that bounded it (#678)", () => {
  const triage = CORE_BUNDLE.find((e) =>
    e.category === "skill" && e.name === "alert-triage-contract"
  );
  assert(triage === undefined, "alert-triage-contract is back — and with it, a reason for Bash");
  const raw = CORE_BUNDLE.find((e) => e.category === "agent" && e.name === "security-expert");
  assert(raw, "no bundle entry: agent/security-expert");
  const tools = /^tools:\s*(.+)$/m.exec(raw.content)?.[1] ?? "";
  assert(tools.length > 0, "security-expert has no tools: line — this assertion read nothing");
  assert(!/\bBash\b/.test(tools), `security-expert grants Bash with no allowlist: ${tools}`);
  const body = flat(raw.content);
  for (const gone of ["Alert triage", "alert-triage-contract", "gh api"]) {
    assert(!body.includes(gone), `security-expert still carries ${JSON.stringify(gone)}`);
  }
});

Deno.test("the trim-safety list is not vacuously empty", () => {
  // A list that quietly emptied would make every test above pass. This is the
  // same failure the size guard had: an assertion that cannot fail.
  const total = MUST_SURVIVE.reduce((n, f) => n + f.sentences.length, 0);
  // 7, not 8: #678 retired alert-triage-contract, whose sentences became the
  // absence assertion above — a population count, not a weaker guard.
  assert(MUST_SURVIVE.length >= 7, `only ${MUST_SURVIVE.length} files covered`);
  assert(total >= 15, `only ${total} sentences guarded`);
});
