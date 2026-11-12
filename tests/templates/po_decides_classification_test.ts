import { assert, assertStringIncludes } from "@std/assert";
import { CORE_BUNDLE, HARNESS_STATIC } from "../../src/templates_bundle.ts";
import { HARNESSES } from "../../src/cli/harnesses.ts";
import { everyBundleOption } from "../../src/application/bundle_options.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";
import { restates } from "./po_single_home.ts";
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

Deno.test("the product owner's section lists its calls and how it reports them", () => {
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
});

Deno.test("the no-ask authority stops at others' items and at a vulnerability's detail", () => {
  const s = flat(section(PO, SECTION));
  // S2: it never reaches an item someone else filed.
  assertStringIncludes(s, "never a reason to close, mark not planned, re-parent or rewrite");
  assertStringIncludes(s, "never copied from another item's body");
  // S1 rests on the item's content, not on who found it, and defaults to public.
  assertStringIncludes(
    s,
    "Any item describing an unfixed vulnerability, whoever found it, is filed with its path and impact withheld unless the dispatch states the tracker is private;",
  );
  assertStringIncludes(s, "a local backlog is as public as the repository it is committed to.");
  assert(!/finding from the security seat/i.test(s), "S1 is keyed on the finder again");
});

Deno.test("the session protocol points at the section", () => {
  const backlog = doc("backlog.md");
  const step2 = flat(
    backlog.slice(backlog.indexOf("2. **Dispatch**"), backlog.indexOf("3. **Take only")),
  );
  assertStringIncludes(
    step2,
    'None of the calls `product-owner.md`\'s "What you decide" gives it is asked of the user',
  );
  assertStringIncludes(step2, "the dispatch carries one only when the user stated it");
});

Deno.test("the router points at the section", () => {
  const skill = entry(
    (e) => e.category === "backlog-skill" && e.name === "task" && e.suffix === null,
    "task/SKILL.md",
  );
  const router = flat(section(skill, "## All backlog writes go through the Product Owner"));
  assertStringIncludes(router, 'its "What you decide" section');
  assertStringIncludes(router, "(`backlog.md`, step 2)");
});

Deno.test("the plan stop points at the section", () => {
  const plan = phase("plan").content;
  const step7 = flat(plan.slice(plan.indexOf("### 7."), plan.indexOf("### 8.")));
  assertStringIncludes(step7, 'never a call `product-owner.md`\'s "What you decide" lists;');
  assertStringIncludes(
    step7,
    "4. anything you decided yourself, one line each, those calls included.",
  );
});

/** Each phrasing of a second home the guard must flag, and what it must let through. */
const PHRASINGS: [sentence: string, flagged: boolean][] = [
  ["The product owner sets the priority and the size of every item.", true],
  ["Priority and size are set by the product owner.", true],
  ["An item's type and size is decided by the product owner.", true],
  ["Its size and type are chosen by the product owner, never asked.", true],
  ["Priority and type, assigned by the product owner, are reported in one line.", true],
  ["Priority and size are the product owner's decision.", true],
  ["Priority and size are the product owner\u2019s decision.", true],
  ["Priority and size remain the call of the product owner.", true],
  ["The product owner will set the priority and the size of every item.", true],
  ["The product owner determines the priority and the size of every item.", true],
  ["Priority and size are chosen, never asked.", true],
  ["Priority and size are the product owner's.", true],
  ["An item's type and size is up to the product owner.", true],
  // After a colon, or as a list its sentence introduces (cli#786).
  ["The product owner decides two things: the priority and the size of every item.", true],
  ["The product owner decides:\n\n- the priority of every item;\n- the size of every item.", true],
  ["The product owner decides:\n- the priority of every item.\n- the size of every item.", true],
  // Neutral prose: a mechanism or a field, nobody deciding.
  ["The choice of the priority and size fields is documented once.", false],
  ["Each call of the priority and size reader costs one request.", false],
  ["The priority and size check is called by the pre-commit hook.", false],
  ["Priority and size changes are made by the edit script, in one request.", false],
  [
    'What the product owner decides is listed once, in `product-owner.md`\'s "What you decide" section.',
    false,
  ],
  ["Priority and size are fields on the board.", false],
  // A bare verb or possessive with no decider as its subject (cli#786).
  ["The edit script sets the priority and size fields in one request.", false],
  ["The pre-commit hook calls the priority and size reader.", false],
  ["The board reader picks the priority and size columns.", false],
  ["The script's call to the priority and size reader is cached.", false],
  [
    "The product owner decides the order:\n\n- one at a time.\n\nOn fields.\n\n- priority and size.",
    false,
  ],
];

Deno.test("the single-home guard flags active, passive and nominal restatements", () => {
  const wrong = PHRASINGS.filter(([s, want]) => restates(s) !== want)
    .map(([s, want]) => `${want ? "missed" : "flagged"}: ${s}`);
  assert(wrong.length === 0, wrong.join("\n"));
});

Deno.test("the list of calls lives in the product owner alone", () => {
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
