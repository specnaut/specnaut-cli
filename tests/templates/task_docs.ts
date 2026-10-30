import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";
import { skillDocName } from "../../src/domain/core_bundle.ts";

/** Lookups shared by the tests that lock the chain's rules in the `/task` docs. */

/** A pipeline phase doc — `/task`'s since cli#683. */
export function phase(name: string): CoreEntry {
  const e = CORE_BUNDLE.find((x) =>
    x.category === "phase" && x.name === "task" && skillDocName(x) === name
  );
  if (!e) throw new Error(`missing phase entry: ${name}`);
  return e;
}

/** A document's text with every whitespace run folded to one space, so a lock pins the words of a
 * rule and not where a line happened to wrap. */
export const flat = (text: string) => text.replace(/\s+/g, " ");

export function rootAgents(): CoreEntry {
  const e = CORE_BUNDLE.find(
    (x) => x.category === "project-root" && x.suffix === "AGENTS.md",
  );
  if (!e) throw new Error("missing root AGENTS.md entry");
  return e;
}
