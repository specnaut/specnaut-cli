import { assert, assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, relative } from "@std/path";

/**
 * One arbiter for size: the constitution's `## Size limits` table, with the
 * defaults in `.specnaut/memory/size-limits.md` for a unit it does not list.
 *
 * Before #646, `code-reviewer` failed functions over 50 lines, `architect-expert`
 * files past 500 LOC and type blocks past 200, and the god-file leaf refused any
 * fixed number at all. A project whose constitution capped functions at 30 got a
 * review that passed a 45-line function, and no agent had a rule saying which
 * number won.
 *
 * The population is every shipped Markdown file under `templates/` and
 * `plugin/` — not a list of the agents that used to carry a number, because the
 * next one would be written somewhere else.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));

/** The only shipped files allowed to state a size threshold. */
const ARBITERS = new Set([
  "templates/core/specnaut/memory/size-limits.md",
  "templates/core/specnaut/memory/constitution.md",
  "templates/core/specnaut/templates/constitution-template.md",
]);

/**
 * A size threshold written as prose: a comparison word or symbol, a number, and
 * a line unit — "past 500 LOC", ">50 lines", "over 300 lines", "more than 40
 * lines". It deliberately does not match a count that is not a limit on code
 * ("up to 5 lines" of a summary, "a 3-line summary").
 */
const THRESHOLD =
  /(?:>|≥|past|over|exceed(?:s|ing)?|more than|longer than|above|beyond)\s*\d+\s*(?:LOC|lines?\b)/i;

async function offenders(): Promise<string[]> {
  const out: string[] = [];
  for (const dir of ["templates", "plugin"]) {
    for await (const e of walk(`${ROOT}${dir}`, { exts: [".md"], includeDirs: false })) {
      const path = relative(ROOT, e.path).replaceAll("\\", "/");
      if (ARBITERS.has(path)) continue;
      const lines = (await Deno.readTextFile(e.path)).replaceAll("\r\n", "\n").split("\n");
      lines.forEach((line, i) => {
        if (THRESHOLD.test(line)) out.push(`${path}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  return out;
}

Deno.test("no shipped doc states a size threshold except the constitution and the defaults", async () => {
  assertEquals(await offenders(), []);
});

Deno.test("the threshold pattern catches the shapes the agents used to carry", () => {
  // Observed red on the pre-#646 text: these are those lines, verbatim.
  for (
    const line of [
      "3. **God-file threshold crossed**: a source file that grew past 500 LOC",
      "   in this diff (or a class/type block past 200 LOC). MEDIUM — readability",
      "5. **Readability**: functions >50 lines, deeply nested conditionals (>3",
    ]
  ) assert(THRESHOLD.test(line), line);
  for (
    const line of [
      "TOP_ISSUES: <up to 5 lines — the highest-severity findings | none>",
      "a 3-line summary",
    ]
  ) {
    assert(!THRESHOLD.test(line), line);
  }
});

Deno.test("the defaults file states the one rule and the default table", async () => {
  // A Windows checkout converts LF to CRLF; the rule's sentence spans a line break.
  const text = (await Deno.readTextFile(`${ROOT}templates/core/specnaut/memory/size-limits.md`))
    .replaceAll("\r\n", "\n");
  assert(text.includes("is the only\nsource of thresholds"), "resolution rule");
  assert(/^\| file \| 300 \| 500 \|$/m.test(text), "file default");
  assert(/^\| function \| 30 \| 50 \|$/m.test(text), "function default");
});
