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
      // The seat must still SAY its Bash grant is constrained, even though the
      // allowlist itself now lives in the preloaded skill (#562). A pointer
      // that stops pointing is how a relocation becomes a deletion.
      "the constrained Bash allowlist, which is the only thing standing between this seat's unconditional `Bash` grant and an arbitrary shell",
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
    body: () => entry("phase", "specnaut", "implement.md"),
    sentences: [
      // An eval-refusal rule on a contributor-writable file, on a path that
      // terminates in EXECUTE_COMMAND. It is stated twice, and collapsing the
      // second copy BY REFERENCE is a legitimate trim; deleting the rule is not.
      "leave condition evaluation to the HookExecutor",
      // Integrity control against a TOCTOU between "reviewed" and "what ships".
      "Freeze the tree.",
      // Secret-exclusion patterns for CONSUMER repositories. Collapsing the
      // per-language rows into the universal set deletes exactly these.
      "*.tfstate",
      "kubeconfig",
    ],
  },
  {
    label: "alert-triage-contract (split out of security-expert under #562)",
    body: () => entry("skill", "alert-triage-contract", null),
    sentences: [
      // The ENTIRE limit on an agent whose frontmatter grants Bash
      // unconditionally. Three near-identical `gh api` snippets make the block
      // read as self-duplication; it is the opposite. It moved file under
      // #562 — so this assertion moved with it, rather than being deleted for
      // failing where the text no longer is.
      "`Bash` is granted ONLY for the `gh api` calls listed below. Do NOT run arbitrary shell commands. Do NOT chain commands. Do NOT redirect to",
      // Removing this lets the seat close real security alerts with nothing
      // behind them.
      "Do NOT auto-close the alert",
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
    label: "board/spec-autogen.md",
    body: () => entry("backlog-doc", "board", "spec-autogen.md"),
    sentences: [
      "**Never fatal to task creation**",
    ],
  },
  {
    label: "board/SKILL.md",
    body: () => entry("backlog-skill", "board", null),
    sentences: [
      // The skill's scope-confinement rule, on an agent holding forge
      // credentials. It sits in the file's tail — the first thing a truncation
      // would eat.
      "this skill is wired to this project only",
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

Deno.test("the trim-safety list is not vacuously empty", () => {
  // A list that quietly emptied would make every test above pass. This is the
  // same failure the size guard had: an assertion that cannot fail.
  const total = MUST_SURVIVE.reduce((n, f) => n + f.sentences.length, 0);
  assert(MUST_SURVIVE.length >= 8, `only ${MUST_SURVIVE.length} files covered`);
  assert(total >= 15, `only ${total} sentences guarded`);
});
