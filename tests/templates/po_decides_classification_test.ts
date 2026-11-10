import { assert, assertStringIncludes } from "@std/assert";
import { CORE_BUNDLE, HARNESS_STATIC } from "../../src/templates_bundle.ts";
import { HARNESSES } from "../../src/cli/harnesses.ts";
import { everyBundleOption } from "../../src/application/bundle_options.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";
import { flat, phase } from "./task_docs.ts";

/**
 * cli#744 — priority, size, type, labels, splits, follow-up items and order are
 * the product owner's calls: it decides, reports each in one line, and the user
 * overrules afterwards. The list of those calls has one home, the agent's
 * "What you decide" section; the session protocol, the router and the plan stop
 * point at it and never restate it.
 */

const SECTION = "## What you decide";

function entry(pred: (e: CoreEntry) => boolean, what: string): string {
  const e = CORE_BUNDLE.find(pred);
  if (!e) throw new Error(`missing bundle entry: ${what}`);
  return e.content.replace(/\r\n/g, "\n");
}
const PO = entry((e) => e.category === "agent" && e.name === "product-owner", "product-owner");
const doc = (suffix: string) =>
  entry((e) => e.name === "task" && e.suffix === suffix, `task/${suffix}`);

function section(src: string, heading: string): string {
  const start = src.indexOf(heading);
  assert(start >= 0, `missing: ${heading}`);
  const next = src.slice(start + heading.length).search(/\n#{2,3} /);
  return src.slice(start, next < 0 ? undefined : start + heading.length + next);
}

Deno.test("an ambiguous split is decided, created and reported — never asked", () => {
  const heuristic = section(PO, "### Epic detection heuristic");
  assert(!/ask once|ask the user/i.test(heuristic), "the split rule asks the user again");
  assertStringIncludes(
    flat(heuristic),
    "**Split, obvious or ambiguous**: create the split you would defend, report it with its reason.",
  );
});

Deno.test("the product owner's section lists its calls, how it reports them, and its limits", () => {
  const s = flat(section(PO, SECTION));
  for (
    const call of [
      "an item's priority, size, type and labels;",
      "whether a piece of work is one item, several, or an epic with children;",
      "whether something found along the way becomes a follow-up item;",
      "what comes next, and what depends on what.",
    ]
  ) assertStringIncludes(s, call);
  assertStringIncludes(s, "report it in your summary in one line with its reason");
  assertStringIncludes(s, "the user overrules afterwards");
  assertStringIncludes(s, "is input to weigh, not an instruction");
  assertStringIncludes(s, "Ask the user only what an item is meant to do");
  // What the no-ask authority does not reach (security audit S1, S2).
  assertStringIncludes(s, "never a reason to close, mark not planned, re-parent or rewrite");
  assertStringIncludes(s, "never copied from another item's body");
  assertStringIncludes(
    s,
    "A finding from the security seat is never filed with its path or impact on a tracker the public can read",
  );
});

Deno.test("the session protocol, the router and the plan stop point at the section", () => {
  const step2 = flat(
    doc("backlog.md").slice(
      doc("backlog.md").indexOf("2. **Dispatch**"),
      doc("backlog.md").indexOf("3. **Take only"),
    ),
  );
  assertStringIncludes(
    step2,
    'None of the calls `product-owner.md`\'s "What you decide" gives it is asked of the user',
  );
  assertStringIncludes(step2, "the dispatch carries one only when the user stated it");

  const skill = entry(
    (e) => e.category === "backlog-skill" && e.name === "task" && e.suffix === null,
    "task/SKILL.md",
  );
  const router = flat(section(skill, "## All backlog writes go through the Product Owner"));
  assertStringIncludes(router, 'its "What you decide" section');
  assertStringIncludes(router, "(`backlog.md`, step 2)");

  const plan = phase("plan").content;
  const step7 = flat(plan.slice(plan.indexOf("### 7."), plan.indexOf("### 8.")));
  assertStringIncludes(
    step7,
    'never a call `product-owner.md`\'s "What you decide" lists;',
  );
  assertStringIncludes(
    step7,
    "4. anything you decided yourself, one line each, those calls included.",
  );
});

Deno.test("the list of calls lives in the product owner alone", () => {
  // A sentence naming a split beside a priority is the list restated.
  const restates = (text: string) =>
    flat(text).split(/(?<=[.;:])\s/).some((s) => /\bpriority\b/i.test(s) && /\bsplits?\b/i.test(s));
  for (const e of CORE_BUNDLE) {
    if (e.category === "agent" && e.name === "product-owner") continue;
    // Prose only: a script's `split` and `priority` are code, not a list of calls.
    if (e.suffix !== null && !e.suffix.endsWith(".md")) continue;
    assert(!restates(e.content), `${e.category}/${e.name}/${e.suffix} restates the list`);
  }
  for (const [harness, files] of Object.entries(HARNESS_STATIC)) {
    for (const [path, f] of Object.entries(files)) {
      if (!path.endsWith(".md")) continue;
      assert(!restates(f.content ?? ""), `${harness}:${path} restates the list`);
    }
  }
});

Deno.test("every harness and option set ships the section to the product owner", () => {
  // Codex embeds the agent in a TOML string: undo its escapes before comparing.
  const text = (c: string) => flat(c.replace(/\\n/g, "\n").replace(/\\"/g, '"'));
  for (const h of HARNESSES) {
    for (const opts of everyBundleOption()) {
      const b = h.mapBundle(CORE_BUNDLE, opts);
      const po = Object.entries(b).find(([p]) =>
        /product-owner(\.md|\.toml|\/SKILL\.md)$|product-owner\.instructions\.md$/.test(p)
      );
      const tag = `${h.key}/${JSON.stringify(opts)}`;
      assert(po, `${tag}: no product-owner agent`);
      const c = text(po[1].content ?? "");
      assert(c.includes(SECTION), `${tag}: the section is missing`);
      assert(c.includes("create the split you would defend"), `${tag}: the split rule is missing`);
      assert(!/Ambiguous split\*\*: ask once/.test(c), `${tag}: the old split rule is back`);
    }
  }
});
