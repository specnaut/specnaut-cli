// Every bundled seat's `tools:` line is pinned (#573).
//
// A tools line is the seat's authority boundary, and the pin makes widening one
// a visible decision: this test refuses to pass until the expected value here
// changes too. It also catches the silent LOSS of a grant, whose only symptom
// would be a seat that quietly stops being able to do what it claims.
//
// Which seats may hold a shell is decided here and nowhere else. A seat that
// reads what it reviews or audits holds Read, Grep and Glob: what needs a
// command is run by the session that briefs it (`phases/review-seats.md`). A
// parenthesised specifier on a tool does not narrow it in a subagent's list —
// `Bash(<pattern>)` grants the whole shell — so no seat carries one as if it did.

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const AGENTS = fromFileUrl(new URL("../../templates/core/agents/", import.meta.url));

/**
 * name -> exact `tools:` value. The population is derived from the directory,
 * not from this table: an agent file with no row here FAILS, so a new seat
 * cannot arrive with an unreviewed authority boundary.
 */
const PINNED = new Map<string, string>([
  ["accessibility-expert", "Read, Grep, Glob"],
  ["architect-expert", "Read, Grep, Glob"],
  ["code-reviewer", "Read, Grep, Glob"],
  ["dependency-expert", "Read, Grep, Glob"],
  ["developer", "Read, Write, Edit, Grep, Glob, Bash"],
  ["performance-expert", "Read, Grep, Glob"],
  ["product-owner", "Read, Write, Edit, Grep, Glob, Bash"],
  // #678: its Bash existed for the alert-triage mode's `gh api` calls; that
  // mode is gone, and every remaining mode reads.
  ["security-expert", "Read, Grep, Glob"],
  ["specnaut-guide", "Read, WebFetch, Grep, Glob, Bash, Agent(developer)"],
]);

/**
 * Specifiers kept knowing they narrow nothing. `Agent(developer)` records the
 * one seat the guide's review-upgrade protocol dispatches; the guide holds a
 * shell by design and is not handed review data, so the pin documents, it does
 * not fence.
 */
const DOCUMENTING_SPECIFIERS = new Map<string, string[]>([
  ["specnaut-guide", ["Agent(developer)"]],
]);

/** `README.md` documents the directory; it is not a seat. */
const NOT_A_SEAT = new Set(["README"]);

async function seatNames(): Promise<string[]> {
  const out: string[] = [];
  for await (const e of Deno.readDir(AGENTS)) {
    if (!e.isFile || !e.name.endsWith(".md")) continue;
    const name = e.name.slice(0, -3);
    if (!NOT_A_SEAT.has(name)) out.push(name);
  }
  return out.sort();
}

function toolsLineOf(md: string): string | null {
  for (const line of md.split("\n")) {
    if (line === "---") continue;
    const m = /^tools:\s*(.+?)\s*$/.exec(line);
    if (m) return m[1];
  }
  return null;
}

/** The tools a value names, split at depth 0, specifiers kept. */
function entriesOf(tools: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of tools) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else current += ch;
  }
  out.push(current.trim());
  return out.filter((e) => e.length > 0);
}

Deno.test("agent tools: the pinned table covers every seat on disk", async () => {
  const seats = await seatNames();
  assert(seats.length > 0, "no agent files found — this assertion stopped looking at anything");
  const unpinned = seats.filter((s) => !PINNED.has(s));
  assertEquals(
    unpinned,
    [],
    `these seats ship with no pinned \`tools:\` value: ${unpinned.join(", ")}. ` +
      `A tools line is a seat's authority boundary; add a row to PINNED so the ` +
      `value is reviewed once rather than never.`,
  );
  const stale = [...PINNED.keys()].filter((k) => !seats.includes(k)).sort();
  assertEquals(
    stale,
    [],
    `PINNED names seats that no longer exist: ${stale.join(", ")}. Prune them — ` +
      `a row guarding nothing reads exactly like a row that is guarding something.`,
  );
});

for (const [name, expected] of PINNED) {
  Deno.test(`agent tools: ${name} carries exactly its pinned grant`, async () => {
    const md = await Deno.readTextFile(join(AGENTS, `${name}.md`));
    const actual = toolsLineOf(md);
    assertEquals(
      actual,
      expected,
      `${name}.md's \`tools:\` line changed.\n\n` +
        `If the change is intended, update PINNED in this file in the same ` +
        `commit — that edit is the review. If it is not, this is the drift the ` +
        `test exists for: a widened grant nobody decided on, or a lost one ` +
        `whose only symptom is a seat that quietly stops being able to check ` +
        `what it claims to check.`,
    );
  });
}

/** No `tools:` line is not "no tools": the harness then grants every tool it has. */
Deno.test("agent tools: every seat declares a tools line", async () => {
  const missing: string[] = [];
  for (const seat of await seatNames()) {
    if (toolsLineOf(await Deno.readTextFile(join(AGENTS, `${seat}.md`))) === null) {
      missing.push(seat);
    }
  }
  assertEquals(missing, [], "a seat with no tools line inherits every tool");
});

Deno.test("agent tools: no seat carries a specifier as if it narrowed a tool", async () => {
  const found: string[] = [];
  for (const seat of await seatNames()) {
    const tools = toolsLineOf(await Deno.readTextFile(join(AGENTS, `${seat}.md`))) ?? "";
    const allowed = DOCUMENTING_SPECIFIERS.get(seat) ?? [];
    for (const entry of entriesOf(tools)) {
      if (entry.includes("(") && !allowed.includes(entry)) found.push(`${seat}: ${entry}`);
    }
  }
  assertEquals(found, [], "a specifier inside a subagent's tools list grants the whole tool");
});

/**
 * An `Agent` grant names the seats it may spawn.
 *
 * The population is the directory, not a list here: a future seat that arrives
 * with a bare `Agent` fails this without anyone remembering to add a row.
 *
 * `specnaut-guide` shipped the only unscoped grant in the bundle. Unscoped is
 * not "slightly wider" — it is every seat, including the orchestrators, so a
 * question about a local file could spawn a chain that answers nothing and
 * spends the whole budget doing it. Its own `review-upgrade` protocol names
 * exactly one seat to dispatch, `developer`, which is what the grant now says.
 */
Deno.test("agent tools: every Agent grant names its seats", async () => {
  const bare: string[] = [];
  for (const seat of await seatNames()) {
    const md = await Deno.readTextFile(join(AGENTS, `${seat}.md`));
    const tools = toolsLineOf(md);
    assert(tools !== null, `${seat} has no tools: line`);
    // `Agent` as a whole entry, rather than `Agent(...)`.
    const entries = tools!.split(",").map((t) => t.trim());
    if (entries.includes("Agent")) bare.push(seat);
  }
  assertEquals(bare, [], "seats granting an unscoped Agent — name the seats they may spawn");
});
