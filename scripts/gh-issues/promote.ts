// gh-issues promote <num> [--priority P0|P1|P2|P3] [--size XS|S|M|L|XL]
// — convert an inbound user-filed issue into a Specnaut backlog ticket.
// Defaults: P3 / M (Kevin reviews and lifts before final apply).
//
// Pipeline:
//   1. Verify the issue carries `from:specnaut-expert` (refuses otherwise).
//   2. move.sh <num> Ready
//   3. set-field.sh <num> Priority <P>  (exit 11 → fall back to label)
//   4. set-field.sh <num> Size <S>      (same fallback contract)
//   5. Public thank-you comment on the issue.

const REPO = "mkrlabs/specnaut";
const BACKLOG_DIR = ".claude/skills/backlog/scripts";

const PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);
const SIZES = new Set(["XS", "S", "M", "L", "XL"]);

const THANK_YOU = `Thanks for the report! 🙏

I've added this to the Specnaut backlog (Status: \`Ready\`). I'll keep this issue updated as the work progresses — no action needed on your end.

If you spot anything else, the bundled \`specnaut-expert\` agent in your project (run \`/specnaut-expert <question>\` or just ask "report this as a bug" when something breaks) can pre-fill structured reports for future fixes.`;

export type PromoteArgs = {
  num: number;
  priority: "P0" | "P1" | "P2" | "P3";
  size: "XS" | "S" | "M" | "L" | "XL";
};

export function parsePromoteArgs(argv: ReadonlyArray<string>): PromoteArgs {
  let num: number | null = null;
  let priority: PromoteArgs["priority"] = "P3";
  let size: PromoteArgs["size"] = "M";

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--priority") {
      const v = argv[++i];
      if (!v || !PRIORITIES.has(v)) {
        throw new Error(`--priority must be one of P0..P3 (got: ${v ?? "<missing>"})`);
      }
      priority = v as PromoteArgs["priority"];
    } else if (a === "--size") {
      const v = argv[++i];
      if (!v || !SIZES.has(v)) {
        throw new Error(`--size must be one of XS|S|M|L|XL (got: ${v ?? "<missing>"})`);
      }
      size = v as PromoteArgs["size"];
    } else if (!a.startsWith("-")) {
      const n = Number(a);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`invalid issue number: ${a}`);
      }
      num = n;
    }
  }
  if (num === null) {
    throw new Error("usage: promote.ts <issue-number> [--priority P0..P3] [--size XS..XL]");
  }
  return { num, priority, size };
}

async function run(cmd: string[]): Promise<{ code: number; out: string; err: string }> {
  const c = new Deno.Command(cmd[0], { args: cmd.slice(1), stdout: "piped", stderr: "piped" });
  const { code, stdout, stderr } = await c.output();
  return {
    code,
    out: new TextDecoder().decode(stdout),
    err: new TextDecoder().decode(stderr),
  };
}

async function fetchLabels(num: number): Promise<string[]> {
  const r = await run([
    "gh",
    "issue",
    "view",
    String(num),
    "--repo",
    REPO,
    "--json",
    "labels",
  ]);
  if (r.code !== 0) throw new Error(`gh issue view failed: ${r.err}`);
  const data = JSON.parse(r.out) as { labels: Array<{ name: string }> };
  return data.labels.map((l) => l.name);
}

async function setField(
  num: number,
  field: "Priority" | "Size",
  value: string,
  labelFallback: string,
): Promise<"field" | "label"> {
  const r = await run([`${BACKLOG_DIR}/set-field.sh`, String(num), field, value]);
  if (r.code === 0) return "field";
  if (r.code === 11) {
    // Field option missing (e.g. priority:P3 — Project V2 only has P0..P2).
    // Fall back to the legacy label, per the contract documented in
    // set-field.sh.
    const lr = await run([
      "gh",
      "issue",
      "edit",
      String(num),
      "--repo",
      REPO,
      "--add-label",
      labelFallback,
    ]);
    if (lr.code !== 0) throw new Error(`label fallback failed: ${lr.err}`);
    return "label";
  }
  throw new Error(`set-field ${field}=${value} failed (exit ${r.code}): ${r.err}`);
}

if (import.meta.main) {
  let args: PromoteArgs;
  try {
    args = parsePromoteArgs(Deno.args);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    Deno.exit(1);
  }

  const labels = await fetchLabels(args.num);
  if (!labels.includes("from:specnaut-expert")) {
    console.error(
      `error: #${args.num} is not labelled \`from:specnaut-expert\` — ` +
        `triage promote is for inbound user-filed issues only.`,
    );
    Deno.exit(2);
  }

  const move = await run([`${BACKLOG_DIR}/move.sh`, String(args.num), "Ready"]);
  if (move.code !== 0) {
    console.error(`move.sh failed: ${move.err}`);
    Deno.exit(1);
  }

  const prioMode = await setField(
    args.num,
    "Priority",
    args.priority,
    `priority:${args.priority}`,
  );
  const sizeMode = await setField(args.num, "Size", args.size, `size:${args.size}`);

  const comment = await run([
    "gh",
    "issue",
    "comment",
    String(args.num),
    "--repo",
    REPO,
    "--body",
    THANK_YOU,
  ]);
  if (comment.code !== 0) {
    console.warn(`warn: thank-you comment failed: ${comment.err}`);
  }

  console.log(
    `✓ #${args.num} → Ready · Priority=${args.priority} (${prioMode}) · Size=${args.size} (${sizeMode})`,
  );
  if (prioMode === "label" || sizeMode === "label") {
    console.log("  (label fallback used — Project V2 field option missing)");
  }
}
