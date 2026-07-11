// gh-issues reject <num> --reason "..." — DRY-RUN only. Prints the
// public comment and `gh issue close` command that would run, then
// exits. The calling session shows this to Kevin and runs it after
// confirmation.
//
// Hard contract: this script never closes anything. Closure goes
// through Kevin's explicit approval.

const REPO = "specnaut/specnaut-cli";

export type RejectArgs = { num: number; reason: string };

export function parseRejectArgs(argv: ReadonlyArray<string>): RejectArgs {
  let num: number | null = null;
  let reason: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--reason") {
      const v = argv[++i];
      if (!v) throw new Error("--reason requires a value");
      reason = v;
    } else if (!a.startsWith("-")) {
      const n = Number(a);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`invalid issue number: ${a}`);
      }
      num = n;
    }
  }
  if (num === null) {
    throw new Error('usage: reject.ts <issue-number> --reason "<explanation>"');
  }
  if (reason === null || reason.trim() === "") {
    throw new Error("--reason is mandatory and must be non-empty");
  }
  return { num, reason };
}

function shellQuote(s: string): string {
  // Single-quote wrap for safe shell pasting; embedded single quotes
  // are escaped via the standard `'\''` trick.
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

if (import.meta.main) {
  let args: RejectArgs;
  try {
    args = parseRejectArgs(Deno.args);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    Deno.exit(1);
  }

  const publicBody =
    `Closing this report — it goes against Specnaut's current methodology / vision.\n\n` +
    `**Reason:** ${args.reason}\n\n` +
    `Thanks for taking the time to file the issue. If you think this decision is wrong, ` +
    `feel free to comment with additional context and we'll re-evaluate.`;

  console.log(`# Reject #${args.num} — DRY RUN`);
  console.log("Show this to Kevin. After explicit approval, run:");
  console.log("");
  console.log(`gh issue comment ${args.num} --repo ${REPO} --body ${shellQuote(publicBody)}`);
  console.log(`gh issue close ${args.num} --repo ${REPO} --reason not_planned`);
  console.log("");
  console.log("(reject.ts itself does NOT close — explicit confirmation gate.)");
}
