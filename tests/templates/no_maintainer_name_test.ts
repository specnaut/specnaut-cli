import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, relative } from "@std/path";

/**
 * Nothing Specnaut ships addresses its maintainer by name (#655).
 *
 * The groom contract, the alert-triage escalation, the using-specnaut
 * rationalisation table and the product-owner memory example said "needs
 * Kevin's input" — so a user's own agent would wait on a stranger. Whoever
 * runs the agent is "the user".
 *
 * The population is every shipped surface: the templates every scaffold is
 * built from, the plugin distribution, and the cockpit mod.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SHIPPED = ["templates", "plugin", "mods"];
const NAME = /\bkevin\b/gi;

Deno.test("no shipped file names the maintainer", async () => {
  const found: string[] = [];
  let scanned = 0;
  for (const dir of SHIPPED) {
    for await (const e of walk(`${ROOT}${dir}`, { includeDirs: false })) {
      if (!/\.(md|mdc|toml|json|ya?ml|sh|ps1|txt|ts|tsx|js)$/.test(e.path)) continue;
      scanned++;
      const text = await Deno.readTextFile(e.path);
      for (const m of text.matchAll(NAME)) {
        found.push(`${relative(ROOT, e.path).replaceAll("\\", "/")}: ${m[0]}`);
      }
    }
  }
  // A walk that matched nothing would pass on an empty population.
  assertEquals(scanned > 300, true, `only ${scanned} files scanned`);
  assertEquals(found, []);
});
