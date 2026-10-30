// Every bundled seat's `tools:` line is pinned (#573).
//
// Nothing asserted these before. That means nothing pinned the present values,
// and nothing would notice a future drift of them — including the silent LOSS
// of a grant. `code-reviewer` carries `Bash(.specnaut/scripts/bash/run-gate.sh fast)`
// so that a rule about whether an assertion bites can be settled by running the
// project's own declared fast gate (#678 — reused, not a list of test runners);
// if that grant were dropped in a later edit, the seat would go back to
// reporting behavioural claims from reading and the only symptom would be
// reviews that look exactly as confident as before.
//
// A tools line is also the seat's authority boundary. Widening one is a real
// decision — this test makes it a visible one, by refusing to pass until the
// expected value here is changed too.

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const AGENTS = fromFileUrl(new URL("../../templates/core/agents/", import.meta.url));

/**
 * name -> exact `tools:` value. The population is derived from the directory,
 * not from this table: an agent file with no row here FAILS, so a new seat
 * cannot arrive with an unreviewed authority boundary.
 */
const PINNED = new Map<string, string>([
  ["accessibility-expert", "Read, Grep, Glob, Bash"],
  ["architect-expert", "Read, Grep, Glob, Bash"],
  ["code-reviewer", "Read, Grep, Glob, Bash(.specnaut/scripts/bash/run-gate.sh fast)"],
  ["dependency-expert", "Read, Grep, Glob, Bash"],
  ["developer", "Read, Write, Edit, Grep, Glob, Bash"],
  ["devops-sre", "Read, Write, Edit, Grep, Glob, Bash"],
  ["performance-expert", "Read, Grep, Glob, Bash"],
  ["product-owner", "Read, Write, Edit, Grep, Glob, Bash"],
  ["qa-tester", "Read, Write, Edit, Grep, Glob, Bash"],
  ["security-expert", "Read, Grep, Glob, Bash"],
  ["specnaut-guide", "Read, WebFetch, Grep, Glob, Bash, Agent(developer)"],
  ["ui-ux-designer", "Read, Edit, Write, Glob, Grep"],
  ["workflow-manager", "Read, Grep, Glob, Bash, Agent(product-owner, developer, qa-tester)"],
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
