import { assert, assertEquals } from "@std/assert";
import { PHASES } from "../../mods/specnaut-cockpit/hooks/core/chain.ts";
Deno.test("the cockpit's phases are the /task router's chainable verbs, then merge", async () => {
  // The phase sequence is declared in several places; this one is checked against the router
  // itself, so a verb folded away there (spec 041 retired `tasks`) cannot linger here.
  const { CORE_BUNDLE } = await import("../../src/templates_bundle.ts");
  const router = CORE_BUNDLE.find((e) => e.category === "backlog-skill" && e.name === "task");
  assert(router, "no /task router in the bundle");
  const line = router.content.match(/Chainable verbs: ([^.\n]+)\./)?.[1] ?? "";
  const chainable = [...line.matchAll(/`([a-z-]+)`/g)].map((m) => m[1]);
  assert(chainable.length > 0, "read no chainable verbs from the router");
  assertEquals([...PHASES], [...chainable, "merge"]);
});
