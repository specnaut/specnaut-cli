import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/**
 * A seat with no shell is told to run nothing. A command in its prose is one it
 * cannot run, and a seat that tries reports a failure instead of a finding;
 * what needs a command is run by the session that briefs it
 * (`phases/review-seats.md` § A brief carries data, never content).
 *
 * The population is every agent file whose `tools:` line grants no Bash, read
 * from the directory, so a seat that loses its shell is swept from that commit
 * on. A code span opening with a command word is the signal. The size report
 * shape `wc -l <before> → <after>` names counts the brief carries; it runs
 * nothing.
 */

const AGENTS = fromFileUrl(new URL("../../templates/core/agents/", import.meta.url));

const COMMAND_SPAN = new RegExp(
  "`(?:(?:git|npm|npx|pnpm|yarn|pip|pip-audit|cargo|composer|bundle|go|tsc|deno|du|ls|rg|find" +
    "|grep|wc|bash|sh|gh|osv-scanner|snyk)\\s[^`]*|madge|rg|[^`\\s]*\\.sh(?:\\s[^`]*)?)`",
  "g",
);
const REPORT_SHAPES = new Set(["`wc -l <before> → <after>`"]);

async function shellLessSeats(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for await (const e of Deno.readDir(AGENTS)) {
    if (!e.isFile || !e.name.endsWith(".md") || e.name === "README.md") continue;
    const md = await Deno.readTextFile(join(AGENTS, e.name));
    const tools = /^tools:\s*(.+?)\s*$/m.exec(md)?.[1] ?? "";
    if (!/(^|,)\s*Bash\b/.test(tools)) out.set(e.name.slice(0, -3), md);
  }
  return out;
}

Deno.test("a seat with no shell names no command to run", async () => {
  const seats = await shellLessSeats();
  assert(seats.size >= 6, `found ${seats.size} shell-less seats; the sweep stopped looking`);
  const hits: string[] = [];
  for (const [seat, md] of seats) {
    for (const m of md.matchAll(COMMAND_SPAN)) {
      if (!REPORT_SHAPES.has(m[0])) hits.push(`${seat}: ${m[0]}`);
    }
  }
  assertEquals(hits, [], "a shell-less seat is told to run a command it cannot run");
});
