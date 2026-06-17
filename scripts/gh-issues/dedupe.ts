// gh-issues dedupe <num> — find similar open + recently-closed issues
// for the given inbound issue. Uses Jaccard token-overlap on titles.
//
// Usage: deno run --allow-run dedupe.ts <issue-number>

import { findCandidates, type IssueRef } from "./_dedupe_heuristic.ts";

const REPO = "mkrlabs/specnaut";

async function ghJson<T>(args: string[]): Promise<T> {
  const cmd = new Deno.Command("gh", { args, stdout: "piped", stderr: "piped" });
  const { code, stdout, stderr } = await cmd.output();
  if (code !== 0) {
    throw new Error(`gh ${args.join(" ")} failed: ${new TextDecoder().decode(stderr)}`);
  }
  return JSON.parse(new TextDecoder().decode(stdout)) as T;
}

async function fetchTitle(num: number): Promise<string> {
  const data = await ghJson<{ title: string }>([
    "issue",
    "view",
    String(num),
    "--repo",
    REPO,
    "--json",
    "title",
  ]);
  return data.title;
}

async function fetchPool(): Promise<IssueRef[]> {
  // Open + last 200 closed issues. The 200 cap on closed is a coarse
  // recency window — anything older is unlikely to be a recurrence
  // signal anyway.
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

if (import.meta.main) {
  const numStr = Deno.args[0];
  if (!numStr) {
    console.error("usage: dedupe.ts <issue-number>");
    Deno.exit(1);
  }
  const num = Number(numStr);
  if (!Number.isFinite(num) || num <= 0) {
    console.error(`invalid issue number: ${numStr}`);
    Deno.exit(1);
  }

  const targetTitle = await fetchTitle(num);
  const pool = await fetchPool();
  const candidates = findCandidates(targetTitle, pool, { excludeNumber: num });

  console.log(`#${num} — "${targetTitle}"\n`);
  if (candidates.length === 0) {
    console.log("  no similar issues found.");
    Deno.exit(0);
  }

  for (const c of candidates) {
    const score = c.score.toFixed(2);
    const tag = c.bucket === "likely-dupe" ? "❗" : c.bucket === "maybe" ? "?" : "·";
    console.log(`  ${tag} #${c.number} (${score}, ${c.bucket}) — ${c.title}`);
  }
}
