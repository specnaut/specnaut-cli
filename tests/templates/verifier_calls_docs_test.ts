import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, relative } from "@std/path";
import { flat } from "./task_docs.ts";

/**
 * How the shipped text calls the verifier: every call runs `phases/script-gate.md` § Resolving the
 * verifier first and then `"$sn" verify-scripts`, never the bare name, and only the merge (its step
 * 0, and `land-feature.sh` through `_verifier.sh`) passes the digests a yes covers. Swept over both
 * template trees, so a doc that starts calling it is checked without editing this file.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const TASK = "templates/core/skills/task/";
const read = (rel: string) => Deno.readTextFileSync(`${ROOT}${rel}`);
const gate = () => read(`${TASK}phases/script-gate.md`);

/** Every text file under the shipped trees, by path from the repository's root. */
async function shipped(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const dir of ["templates", "plugin"]) {
    for await (const e of walk(`${ROOT}${dir}`, { includeDirs: false })) {
      const bytes = await Deno.readFile(e.path);
      if (bytes.includes(0)) continue;
      out.set(relative(ROOT, e.path).replaceAll("\\", "/"), new TextDecoder().decode(bytes));
    }
  }
  return out;
}

/**
 * The one bare call left, and why: under the review lock a command runs alone, with no variable,
 * so the untrusted review starts through the resolved verifier and calls the bare name after.
 */
const LOCKED_CALL = "Run `specnaut verify-scripts` alone, not step 1's block";

Deno.test("no shipped file calls the verifier by its bare name", async () => {
  const bare: string[] = [];
  for (const [path, text] of await shipped()) {
    if (text.replaceAll(LOCKED_CALL, "").includes("specnaut verify-scripts")) bare.push(path);
  }
  assertEquals(bare, []);
  const untrusted = flat(read(`${TASK}phases/review-untrusted.md`));
  const resolve = untrusted.indexOf("§ Resolving the verifier's block, then this one");
  assert(resolve >= 0 && resolve < untrusted.indexOf('"$sn" review start'));
  assert(!untrusted.includes("(specnaut review start"), "the start runs the PATH's specnaut");
  assertStringIncludes(untrusted, "a `VERIFIER REFUSED` line stops the review");
});

Deno.test("every doc that calls the verifier resolves it first, in the same shell", async () => {
  const callers = [...await shipped()].filter(([, t]) => t.includes('"$sn" verify-scripts'));
  const names = callers.map(([p]) => p.replace(/^(templates\/core|plugin)\//, "")).sort();
  assertEquals([...new Set(names)], [
    "skills/task/phases/merge.md",
    "skills/task/phases/review.md",
    "skills/task/phases/script-gate.md",
    "specnaut/scripts/bash/_verifier.sh",
  ]);
  for (const [path, text] of callers.filter(([p]) => p.endsWith(".md"))) {
    assertStringIncludes(flat(text), "§ Resolving the verifier's block, then", path);
  }
  const land = read("templates/core/specnaut/scripts/bash/land-feature.sh");
  assertStringIncludes(land, "\nresolve_specnaut\njudge_head\n");
});

Deno.test("the resolve block refuses a relative name and anything inside the repository", () => {
  const block = gate().split("<!-- script-gate: resolve-verifier -->")[1];
  assert(block !== undefined, "script-gate.md lost its resolve anchor");
  for (
    const part of [
      "p=$(\\builtin command -v specnaut)",
      'case $p in /*) ;; "") why="is not on the PATH" ;; *) why="is not an absolute path" ;; esac',
      '[ "$a" -ef "$top" ]',
      't=$(readlink "$p")',
      'echo "VERIFIER REFUSED: ${p:-specnaut} $why"',
    ]
  ) assertStringIncludes(block.slice(0, block.indexOf("```\n")), part);
});

Deno.test("the gate block verifies first and words a refusal as the review does", () => {
  const block = gate().split("<!-- script-gate: verify-scripts -->")[1];
  assert(block !== undefined, "script-gate.md lost its anchor");
  const call = block.indexOf('"$sn" verify-scripts');
  assert(call >= 0 && call < block.indexOf("SCRIPTS TRUSTED"), "the gate does not verify first");
  const review = read(`${TASK}phases/review.md`);
  for (
    const line of [
      '[ "$last" = "VERDICT scripts trusted" ]',
      "SCRIPTS NOT RUN: verify-scripts exit $rc",
    ]
  ) {
    assertStringIncludes(block, line);
    assertStringIncludes(review, line);
  }
  assertStringIncludes(flat(gate()), "Never fall back to a script of the tree");
});

/** Where a digest flag may be named: merge's step 0, the merge's sections of the gate doc, the landing. */
function allowedSpans(path: string, text: string): string {
  const doc = path.replace(/^(templates\/core|plugin)\//, "");
  if (/^specnaut\/scripts\/bash\/(_verifier|land-feature)\.sh$/.test(doc)) return text;
  if (doc === "skills/task/phases/merge.md") {
    return text.slice(text.indexOf("0. **Check the helper scripts"), text.indexOf("1. **Shape"));
  }
  if (doc === "skills/task/phases/script-gate.md") {
    const outcomes = text.slice(text.indexOf("## Merge's step 0 outcomes"));
    return outcomes.slice(0, outcomes.indexOf("## The config verdicts")) +
      text.slice(text.indexOf("### The instructions verdict"));
  }
  return "";
}

Deno.test("only the merge passes the verifier a digest", async () => {
  const strays: string[] = [];
  for (const [path, text] of await shipped()) {
    const total = text.match(/--approved-(scripts|instructions)/g)?.length ?? 0;
    const allowed = allowedSpans(path, text).match(/--approved-(scripts|instructions)/g)?.length ??
      0;
    if (total !== allowed) strays.push(path);
  }
  assertEquals(strays, []);
});

/** The gate doc from § Merge's step 0 outcomes on, its whitespace folded. */
const outcomes = () => {
  const g = flat(gate());
  return g.slice(g.indexOf("## Merge's step 0 outcomes"));
};

Deno.test("merge step 0 reads Approved, Moved on a moved line, then Held, before the exit-1 case", () => {
  const o = outcomes();
  const at = (row: string) => o.indexOf(`- **${row}** — `);
  assert(at("Approved") > 0, "no Approved row");
  assertStringIncludes(o, "- **Approved** — the run passed a digest, exit 0");
  assertStringIncludes(o, "- **Moved** — an `APPROVAL <class> moved` line, whatever the exit");
  assertStringIncludes(o, "- **Held** — the run passed a digest, exit 1, and every `APPROVAL`");
  const order = ["Approved", "Moved", "Held", "Exit 1, read only"].map((r) =>
    o.indexOf(`- **${r}`)
  );
  assertEquals(order, [...order].sort((a, b) => a - b), "rows out of order");
});

Deno.test("Moved asks again from a run without the flag; Held counts a held class as trusted", () => {
  const o = outcomes();
  assertStringIncludes(o, "the phase never compares digests itself");
  assertStringIncludes(o, "Run step 0 again without that flag and read that run from the top");
  assertStringIncludes(
    o,
    "Read the run as one without flags, each class whose line holds counted as trusted: the " +
      "scripts by the cases below, the instructions by § The instructions verdict, whose question " +
      "is asked before step 3.",
  );
  assertStringIncludes(
    flat(gate()),
    "its `APPROVAL instructions holds` line answers this question: it is not asked again",
  );
});

Deno.test("merge step 3 passes both digests", () => {
  assertStringIncludes(
    flat(read(`${TASK}phases/merge.md`)),
    "land-feature.sh [--scripts-digest <SCRIPTS_DIGEST>] [--instructions-digest <INSTRUCTIONS_DIGEST>]",
  );
});
