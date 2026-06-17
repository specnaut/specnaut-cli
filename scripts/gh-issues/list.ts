// gh-issues list — enumerate inbound issues filed by users via the
// specnaut-expert bug-report protocol. Filtered by the
// `from:specnaut-expert` label so it doesn't catch maintainer-filed
// items.
//
// Usage: deno run --allow-run list.ts

const REPO = "mkrlabs/specnaut";
const LABEL = "from:specnaut-expert";

type GhIssue = {
  number: number;
  title: string;
  createdAt: string;
  url: string;
  author?: { login: string };
};

async function ghList(): Promise<GhIssue[]> {
  const cmd = new Deno.Command("gh", {
    args: [
      "issue",
      "list",
      "--repo",
      REPO,
      "--label",
      LABEL,
      "--state",
      "open",
      "--json",
      "number,title,createdAt,url,author",
      "--limit",
      "100",
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  if (code !== 0) {
    throw new Error(`gh issue list failed: ${new TextDecoder().decode(stderr)}`);
  }
  return JSON.parse(new TextDecoder().decode(stdout)) as GhIssue[];
}

if (import.meta.main) {
  const issues = await ghList();
  if (issues.length === 0) {
    console.log("✓ inbox empty (no open issues with label `from:specnaut-expert`)");
    Deno.exit(0);
  }

  console.log(`Inbox: ${issues.length} open issue${issues.length > 1 ? "s" : ""}\n`);
  for (const i of issues) {
    const day = i.createdAt.slice(0, 10);
    const author = i.author?.login ?? "unknown";
    const titleTrim = i.title.length > 70 ? i.title.slice(0, 67) + "…" : i.title;
    console.log(`  #${String(i.number).padStart(3)} ${day} ${author.padEnd(14)} ${titleTrim}`);
  }
  console.log(`\n  ${REPO}/issues?q=is%3Aopen+label%3A${encodeURIComponent(LABEL)}`);
}
