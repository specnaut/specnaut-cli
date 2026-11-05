// gh-issues groom-inbox — orchestrator. List inbound issues + dedupe
// each against open + recently-closed pool + emit a Markdown table
// with proposed actions. Kevin reads, replies in batch, the calling
// session dispatches promote.ts / reject.ts per line.
//
// Usage: deno run --allow-run groom-inbox.ts

import { findCandidates, type IssueRef } from "./_dedupe_heuristic.ts";

const REPO = "specnaut/specnaut-cli";
// The label is named for the agent that files through it. It must exist on
// the repo: GitHub drops an unknown label from an `issues/new?labels=`
// prefill without erroring, so a mismatch here yields an inbox that is
// empty because nothing can enter it.
const INBOUND_LABEL = "from:specnaut-guide";

type GhIssue = IssueRef & { createdAt: string };

async function ghJson<T>(args: string[]): Promise<T> {
  const cmd = new Deno.Command("gh", { args, stdout: "piped", stderr: "piped" });
  const { code, stdout, stderr } = await cmd.output();
  if (code !== 0) {
    throw new Error(`gh ${args.join(" ")} failed: ${new TextDecoder().decode(stderr)}`);
  }
  return JSON.parse(new TextDecoder().decode(stdout)) as T;
}

async function fetchInbox(): Promise<GhIssue[]> {
  return await ghJson<GhIssue[]>([
    "issue",
    "list",
    "--repo",
    REPO,
    "--label",
    INBOUND_LABEL,
    "--state",
    "open",
    "--json",
    "number,title,createdAt",
    "--limit",
    "100",
  ]);
}

async function fetchPool(): Promise<IssueRef[]> {
  const open = await ghJson<IssueRef[]>([
    "issue",
    "list",
    "--repo",
    REPO,
    "--state",
    "open",
    "--json",
    "number,title",
    "--limit",
    "200",
  ]);
  const closed = await ghJson<IssueRef[]>([
    "issue",
    "list",
    "--repo",
    REPO,
    "--state",
    "closed",
    "--json",
    "number,title",
    "--limit",
    "200",
  ]);
  return [...open, ...closed];
}

function trim(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

/** Escape a value for a GitHub-flavoured Markdown table cell. Escape `\` FIRST,
 *  then `|` — escaping `|` alone is incomplete (a backslash in the input would
 *  otherwise consume the escape and let a `|` break the column). Always trim the
 *  RAW string before escaping so truncation can't split an escape sequence. */
function escapeMdCell(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

if (import.meta.main) {
  const [inbox, pool] = await Promise.all([fetchInbox(), fetchPool()]);

  if (inbox.length === 0) {
    console.log(
      "✓ no open issue labelled `from:specnaut-guide`. Labelled reports only: unlabelled " +
        "ones are in the sweep of untracked issues.",
    );
    Deno.exit(0);
  }

  console.log(`# Triage groom-inbox — ${inbox.length} issue${inbox.length > 1 ? "s" : ""}\n`);
  console.log("| # | Title | Opened | Dedupe candidates | Proposed action |");
  console.log("|---|-------|--------|-------------------|-----------------|");

  for (const issue of inbox) {
    const candidates = findCandidates(issue.title, pool, {
      excludeNumber: issue.number,
      topN: 2,
    }).filter((c) => c.bucket !== "unrelated");

    const dupeCol = candidates.length === 0 ? "—" : candidates
      .map((c) => `#${c.number} (${c.score.toFixed(2)} ${c.bucket})`)
      .join("<br>");
    const likely = candidates.find((c) => c.bucket === "likely-dupe");
    const action = likely ? `mark-dupe of #${likely.number}?` : "promote (P3/M)";
    const day = issue.createdAt.slice(0, 10);
    const title = escapeMdCell(trim(issue.title, 60));
    console.log(`| ${issue.number} | ${title} | ${day} | ${dupeCol} | ${action} |`);
  }

  console.log("");
  console.log("## Next steps");
  console.log("Reply with one line per issue, e.g.:");
  console.log("");
  console.log("```");
  console.log("175 promote");
  console.log("175 promote --priority P1 --size S");
  console.log('176 reject --reason "duplicate of #163"');
  console.log("```");
  console.log("");
  console.log(
    "The calling session runs `promote.ts` / `reject.ts` per line. `reject.ts` is dry-run — final close requires Kevin's explicit confirmation.",
  );
}
