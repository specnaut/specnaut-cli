import { assert, assertMatch } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";

/**
 * The session protocol (`task/backlog.md`) carries the product owner's plan
 * across several Bash calls, and a shell variable does not outlive the call
 * that set it. So the plan directory's path is printed once and written out
 * literally in the Write and the apply call, never as `$d`; and the run ends by
 * removing the plan directory and the items file's directory.
 */

const protocol = () => {
  const doc = CORE_BUNDLE.find((e) => e.content.includes("## The session protocol"));
  assert(doc, "task/backlog.md is not bundled");
  const text = doc.content.replace(/\s+/g, " ");
  return text.slice(text.indexOf("## The session protocol"), text.indexOf("<!-- BEGIN"));
};

Deno.test("the plan directory's path is printed, then used literally", () => {
  const steps = protocol();
  assertMatch(steps, /mktemp -d\)[^`]*&& echo "\$d"/);
  assertMatch(steps, /keep the absolute path it prints/);
  assert(!/\$d\/plan\.jsonl/.test(steps), "a later step still reads the shell variable");
});

Deno.test("the run ends by removing the plan and items directories", () => {
  assertMatch(
    protocol(),
    /Clean up\*?\*? [^.]*`rm -rf <each plan directory> <the ITEMS_FILE's directory>`/,
  );
});
