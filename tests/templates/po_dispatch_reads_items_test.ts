import { assert, assertEquals } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";

/**
 * The product owner holds no shell, so every dispatch of it is preceded by the
 * session's own read: `read-items.sh`, which hands it the issue text as data
 * (`task/backlog.md`, "The session protocol"). A doc that dispatches the seat
 * without naming that read would brief a seat that cannot read the tracker —
 * or tempt the session to paste issue text into the brief. The population is
 * every bundled doc whose prose dispatches the seat, with a floor so the sweep
 * cannot pass by matching nothing.
 */

const DISPATCH =
  /\b(dispatch(?:es|ed)?|invoke|go through)\b[^.\n]{0,60}(`product-owner`|Product Owner)|product-owner`? creates/i;

Deno.test("every doc that dispatches the product-owner names read-items.sh", () => {
  const docs = CORE_BUNDLE.filter((e) => e.category !== "agent")
    .filter((e) => DISPATCH.test(e.content.replace(/\*\*/g, "").replace(/\s+/g, " ")));
  const names = docs.map((e) => `${e.name}/${e.suffix ?? "-"}`).sort();
  assert(names.length >= 3, `the sweep found too few dispatching docs: ${names.join(", ")}`);
  const missing = docs.filter((e) => !e.content.includes("read-items.sh"))
    .map((e) => `${e.name}/${e.suffix ?? "-"}`);
  assertEquals(missing, [], `dispatches the product-owner without the read: ${missing.join(", ")}`);
});
