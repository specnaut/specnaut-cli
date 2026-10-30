import { assert } from "@std/assert";
import { agentsMd, EXEMPT_KEY } from "./constitution_reference.ts";
import { routers } from "./verb_table.ts";

/**
 * The mobile-first contract's opt-out (#576 FR-005, spec 038 FR-009): where a
 * project declares a narrower target surface, in what form, and that nothing
 * else counts. Out of `mobile_first_contract_test.ts`, which sits over its
 * size target.
 */

/** Hard-wrapped Markdown: match the content, not where the line break fell. */
const flat = (s: string) => s.replace(/\s+/g, " ");

function contractEntry() {
  const e = routers().find((x) => x.name === "mobile-first-contract");
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
  const uiDefaults =
    /<!-- --- Specnaut: ui-defaults --- -->([\s\S]*?)<!-- --- End Specnaut: ui-defaults/
      .exec(agentsMd().content)?.[1];
  assert(uiDefaults, "the ui-defaults section is missing");
  assert(uiDefaults.includes("`.specnaut/ui.yml`"), "the section names where the exception lives");
  // The whole contract minus its exemption line: that key says why it does not
  // open with the reference (spec 039), not where a value lives. A `description:`
  // that names the constitution is still caught (cli#706).
  const contract = contractEntry().content.replace(new RegExp(`^${EXEMPT_KEY}:.*\n`, "m"), "");
  for (const text of [contract, uiDefaults]) {
    assert(!/constitution/i.test(text), "names the constitution");
    assert(!flat(text).includes("Target surface"), "names the old heading");
    assert(!flat(text).includes("Front-end patterns"), "names a constitution section");
  }
});
