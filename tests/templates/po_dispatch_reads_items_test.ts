import { assert, assertEquals } from "@std/assert";
import { CORE_BUNDLE, HARNESS_STATIC } from "../../src/templates_bundle.ts";

/**
 * The product owner holds no shell, so every dispatch of it is preceded by the
 * session's own read: `read-items.sh`, which hands it the issue text as data
 * (`task/backlog.md`, "The session protocol"). A doc that dispatches the seat
 * without naming that read would brief a seat that cannot read the tracker —
 * or tempt the session to paste issue text into the brief. The population is
 * every bundled file, core and harness-specific, whose prose dispatches the
 * seat — by a verb, an `@product-owner` mention or the headless dispatch
 * script — with a floor so the sweep cannot pass by matching nothing.
 */

const DISPATCH = new RegExp(
  [
    /\b(dispatch(?:es|ed)?|invoke|go through)\b[^.\n]{0,60}(`product-owner`|Product Owner)/,
    /product-owner`? creates/,
    /@product-owner\b/,
    /dispatch-agent\.sh product-owner\b/,
  ].map((r) => r.source).join("|"),
  "i",
);

Deno.test("every file that dispatches the product-owner names read-items.sh", () => {
  const files: Array<[string, string]> = [
    ...CORE_BUNDLE.filter((e) => e.category !== "agent")
      .map((e): [string, string] => [`${e.name}/${e.suffix ?? "-"}`, e.content]),
    ...Object.entries(HARNESS_STATIC).flatMap(([h, fs]) =>
      Object.entries(fs).map(([path, f]): [string, string] => [`${h}:${path}`, f.content])
    ),
  ];
  const docs = files.filter(([, text]) =>
    DISPATCH.test(text.replace(/\*\*/g, "").replace(/\s+/g, " "))
  );
  const names = docs.map(([name]) => name).sort();
  assert(names.length >= 3, `the sweep found too few dispatching docs: ${names.join(", ")}`);
  const missing = docs.filter(([, text]) => !text.includes("read-items.sh")).map(([n]) => n);
  assertEquals(missing, [], `dispatches the product-owner without the read: ${missing.join(", ")}`);
});
