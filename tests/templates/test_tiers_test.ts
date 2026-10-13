import { assert, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

/**
 * #658 — the bundled workflow commits once per task, so what runs at a commit
 * has to be cheap. Three moments, three contents: static checks at every
 * commit, the unit suite once when the work is done, unit plus functional /
 * end-to-end once at the merge. These assertions pin the shipped text that
 * says so, because each one is a sentence an agent obeys literally.
 */

const CORE = fromFileUrl(new URL("../../templates/core/", import.meta.url));
const read = (rel: string) => Deno.readTextFileSync(CORE + rel);

/** The text between `start` and the next heading of the same or higher level. */
function section(doc: string, start: string): string {
  const at = doc.indexOf(start);
  assert(at >= 0, `section not found: ${start}`);
  const level = start.match(/^#+/)![0].length;
  const rest = doc.slice(at + start.length);
  const next = rest.search(new RegExp(`\\n#{1,${level}} `));
  return next < 0 ? rest : rest.slice(0, next);
}

/** Runner invocations a stack-agnostic surface must not hard-code. */
const RUNNERS = /deno task test|deno test\b|npm test|npx (vitest|jest)|pytest|cargo test|go test/;

Deno.test("gates.yml: fast_gate is a static pass, the suite is in full_gate", () => {
  const yml = read("specnaut/gates.yml");
  const fast = yml.slice(yml.indexOf("#   fast_gate —"), yml.indexOf("#   full_gate —"));
  assert(!/unit tests,/i.test(fast), `fast_gate comment lists unit tests:\n${fast}`);
  assertStringIncludes(fast, "Not the unit suite");
  assertStringIncludes(fast, "formatter, linter, type checker");
  const example = yml.slice(yml.indexOf("#   fast_gate:"));
  const fastEx = example.slice(0, example.indexOf("#   full_gate:"));
  const fullEx = example.slice(example.indexOf("#   full_gate:"));
  assert(!/unit|test/i.test(fastEx), `fast_gate example runs tests:\n${fastEx}`);
  assertStringIncludes(fullEx, "<your unit test command>");
  assertStringIncludes(fullEx, "<your end-to-end suite>");
  assertStringIncludes(yml, "Specnaut installs no hook");
});

Deno.test("quality-gates.md names three moments, and fast is static", () => {
  const doc = read("skills/specnaut/phases/quality-gates.md");
  const table = section(doc, "## Three moments, and what runs at each");
  assertStringIncludes(table, "| **Every commit**");
  assertStringIncludes(table, "**No unit suite.**");
  assertStringIncludes(table, "| **Work done**");
  assertStringIncludes(table, "| **Merge**");
  assertStringIncludes(table, "should carry the\nstatic checks only");
  const fast = section(doc, "## `fast` — after every child commit");
  assertStringIncludes(fast, "**static pass**");
  assert(!/unit tests,/.test(fast), "fast tier still lists unit tests");
  assert(
    !doc.includes("no bundled Specnaut file names"),
    "the false claim is back: review.md's detection table names runners",
  );
  assertStringIncludes(doc, "`phases/review.md`'s auto-detect table");
});

Deno.test("review.md runs the test command once per item and reports the skip", () => {
  const doc = read("skills/specnaut/phases/review.md");
  const phase2 = section(doc, "## Phase 2 — Quality gates (auto-detected)");
  assertStringIncludes(phase2, "**do not\nrun the test command**");
  assertStringIncludes(phase2, "never as PASS");
  const report = section(doc, "## Phase 4 — Final report");
  assertStringIncludes(report, "SKIPPED (epic child — runs at the last review)");
});

Deno.test("verification-before-completion scopes the suite and names no runner", () => {
  const doc = read("skills/verification-before-completion/SKILL.md");
  const item1 = section(doc, "### 1. Tests are actually green");
  assertStringIncludes(item1, "the tests **relevant\n  to your change**");
  assertStringIncludes(item1, "**whole** unit suite, once");
  // Everything but the maintainer-only section, which names this repository's
  // own tools behind an explicit condition.
  const maintainer = section(doc, "## If this project *is* the Specnaut bundle source");
  const generic = doc.replace(maintainer, "");
  const hit = generic.match(RUNNERS);
  assert(hit === null, `generic section hard-codes a runner: ${hit?.[0]}`);
});

Deno.test("workflow-contract's VALIDATION example names no runner", () => {
  const doc = read("skills/workflow-contract/SKILL.md");
  const hit = doc.match(RUNNERS);
  assert(hit === null, `workflow-contract hard-codes a runner: ${hit?.[0]}`);
});
