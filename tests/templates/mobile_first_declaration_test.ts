import { assert } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { bodyOf } from "./constitution_reference.ts";

/**
 * The mobile-first contract's opt-out (#576 FR-005, spec 038 FR-009): where a
 * project declares a narrower target surface, in what form, and that nothing
 * else counts. Out of `mobile_first_contract_test.ts`, which sits over its
 * size target.
 */

/** Hard-wrapped Markdown: match the content, not where the line break fell. */
const flat = (s: string) => s.replace(/\s+/g, " ");

function contractEntry() {
  const e = CORE_BUNDLE.find((x) => x.category === "skill" && x.name === "mobile-first-contract");
  assert(e, "mobile-first-contract is not in CORE_BUNDLE");
  return e;
}

/**
 * FR-005 — the opt-out is only real if the contract says what counts as one.
 * Spec 038 (FR-009): it is declared in `.specnaut/ui.yml`, and the contract
 * names no constitution section — the constitution is the team's document,
 * and a framework setting in it is one an amendment can delete by accident.
 */
Deno.test("the contract states the literal declaration form AND the fail-safe", () => {
  const { content } = contractEntry();
  assert(
    /^target_surface: "[^"\n]+"$/m.test(content),
    "the contract must show the exact line a project writes",
  );
  assert(
    flat(content).includes("at most one hundred and twenty printable characters"),
    "the value's limit (S4)",
  );
  assert(
    /not matching that form is treated as absent/i.test(flat(content)),
    "without this sentence, ambiguity fails OPEN and a project loses the default silently",
  );
  assert(
    /`\.specnaut\/ui\.yml`/.test(content),
    "the contract must name the file the declaration goes in",
  );
});

Deno.test("no constitution section is where the exception or the values live", () => {
  const agents = CORE_BUNDLE.find((e) => e.category === "project-root" && e.suffix === "AGENTS.md");
  assert(agents, "the root AGENTS.md is not in CORE_BUNDLE");
  const uiDefaults =
    /<!-- --- Specnaut: ui-defaults --- -->([\s\S]*?)<!-- --- End Specnaut: ui-defaults/
      .exec(agents.content)?.[1];
  assert(uiDefaults, "the ui-defaults section is missing");
  assert(uiDefaults.includes("`.specnaut/ui.yml`"), "the section names where the exception lives");
  // The contract's prose, not its frontmatter: `constitution-exempt` is the key
  // that says why it does not open with the reference (spec 039), not a pointer.
  for (const text of [bodyOf(contractEntry().content), uiDefaults]) {
    assert(!/constitution/i.test(text), "names the constitution");
    assert(!flat(text).includes("Target surface"), "names the old heading");
    assert(!flat(text).includes("Front-end patterns"), "names a constitution section");
  }
});
