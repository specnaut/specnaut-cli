import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { git, type Run, run, type Sandbox, sandbox } from "./git_sandbox.ts";

/**
 * cli#760 — the agent's half of a closeout re-entered from the intake gate's
 * line, on the local backend with the real scripts (closeout_resume_test.ts):
 * it reads only the gate's line and the exits, never feature.json, and stops
 * wherever merge-close.md and resume.md say it stops.
 *
 * The limit this leaves: the rows of merge-close.md § Re-entry and resume.md
 * are re-encoded here in TypeScript, so a doc edit alone reddens nothing in the
 * tests that use this fixture. Every branch it takes is pinned to the sentence
 * that defines it, in tests/templates/intake_gate_docs_test.ts ("every branch
 * the closeout fixture takes"); a branch added here gets a row there.
 */

const LOCAL = fromFileUrl(new URL("../../templates/core/skills/task/scripts/", import.meta.url));
export const DIR = ".specnaut/specs/001-x";
export const lines = (out: string) => out.trim().split("\n");

/** A sandbox with the local backend installed and a backlog the tree ignores. */
export async function project(items: Record<string, { status: string; parent?: string }>) {
  const sb = await sandbox();
  await installLocalBacklog(sb);
  await Deno.mkdir(join(sb.work, ".specnaut/backlog"), { recursive: true });
  for (const [n, { status, parent }] of Object.entries(items)) {
    await Deno.writeTextFile(
      join(sb.work, `.specnaut/backlog/${n.padStart(3, "0")}-item.md`),
      `---\nnumber: ${n}\ntitle: Item ${n}\nstatus: ${status}\n${
        parent ? `parent: "#${parent}"\n` : ""
      }---\n\nBody.\n`,
    );
  }
  return sb;
}

/** The local backend's scripts, committed; the backlog they write, excluded from the tree. */
async function installLocalBacklog(sb: Sandbox) {
  const dest = join(sb.work, ".specnaut/scripts/backlog");
  await Deno.mkdir(dest, { recursive: true });
  for await (const e of Deno.readDir(join(LOCAL, "local"))) {
    await Deno.copyFile(join(LOCAL, "local", e.name), join(dest, e.name));
  }
  await Deno.copyFile(join(LOCAL, "_close_shipped.sh"), join(dest, "_close_shipped.sh"));
  await git(sb.work, "add", ".specnaut/scripts/backlog");
  await git(sb.work, "commit", "--quiet", "-m", "chore: the local backlog scripts");
  await Deno.writeTextFile(
    join(sb.work, ".git/info/exclude"),
    ".specnaut/backlog/\n.specnaut/backlog.md\n",
  );
}

export const status = async (sb: Sandbox, n: string) =>
  /^status: (.*)$/m.exec(
    await Deno.readTextFile(join(sb.work, `.specnaut/backlog/${n.padStart(3, "0")}-item.md`)),
  )![1];

/** A landing as merge leaves it, pushed: the spec, the marker, the work. */
export async function land(sb: Sandbox, json: string, ...message: string[]) {
  await Deno.mkdir(join(sb.work, DIR), { recursive: true });
  await Deno.writeTextFile(join(sb.work, DIR, "plan.md"), "# plan\n");
  await git(sb.work, "add", DIR);
  const sha = await sb.commit(".specnaut/feature.json", json, ...message);
  await git(sb.work, "push", "--quiet", "origin", "main");
  return sha;
}

export const backlog = (sb: Sandbox, name: string, ...args: string[]) =>
  run("bash", [`.specnaut/scripts/backlog/${name}`, ...args], sb.work);
export const gate = (sb: Sandbox, ...args: string[]) =>
  sb.script("wip-audit.sh", "--gate", ...args);

export type Stop = "stopped" | "held" | "removed" | "unpushed";
type Spend = () => boolean;

/**
 * merge-close.md § Re-entry from one `OWN closeout|partial <n> <dir> <sha>` line,
 * running at most `budget` script calls — an interruption is a budget spent.
 */
export async function reenter(
  sb: Sandbox,
  line: string,
  budget = Infinity,
): Promise<Stop | "interrupted"> {
  const m = /^OWN (closeout|partial) ([1-9][0-9]*) (-|\S+) ([0-9a-f]{40})$/.exec(line);
  assert(m, `not a closeout line: ${line}`);
  const [, kind, n, dir] = m;
  let calls = 0;
  const spend = () => ++calls > budget;
  if (kind === "closeout") {
    const stop = await closeEach(sb, await shipped(sb, n), spend);
    if (stop) return stop;
  }
  if (spend()) return "interrupted";
  return await removeSpec(sb, n, dir);
}

/** Re-entry step 3: the children both `--landed` and `cascade-check.sh --numbers` list, then the item. */
async function shipped(sb: Sandbox, n: string): Promise<string[]> {
  const landed = (await sb.script("epic-status.sh", "--landed", `${n}@0`)).stdout;
  const kids = new Set(lines((await backlog(sb, "cascade-check.sh", "--numbers", n)).stdout));
  const children = [...landed.matchAll(/^CHILD T\d+ #(\d+) /gm)].map((c) => c[1]);
  return [...children.filter((c) => kids.has(c)), n];
}

/** Step 2, with step 3 per item as on local: its check, then its close, before the next item's check. */
async function closeEach(sb: Sandbox, items: string[], spend: Spend) {
  for (const item of items) {
    if (spend()) return "interrupted";
    const cc = (await backlog(sb, "cascade-check.sh", item)).code;
    if (cc === 11 || cc === 3) return "stopped";
    if (cc !== 0 && cc !== 12) throw new Error(`cascade-check ${item}: ${cc}`);
    if (spend()) return "interrupted";
    if ((await backlog(sb, "close-shipped.sh", item)).code === 20) return "held";
  }
  return null;
}

/** Step 4: the marker alone when the line's `<dir>` is `-`, else the directory by its last segment. */
async function removeSpec(sb: Sandbox, n: string, dir: string): Promise<Stop> {
  const rm = dir === "-"
    ? await sb.script("remove-spec.sh", "--marker-only", n)
    : await sb.script("remove-spec.sh", dir.split("/").at(-1)!);
  if (rm.code === 7) return "unpushed";
  assertEquals(rm.code, 0, rm.stderr);
  return "removed";
}

/**
 * resume.md's rows, until the gate is clear: the (P) row, the closeout row and
 * the FENCED row, whose question is answered by `answer` (no answer: no yes).
 */
export async function resume(sb: Sandbox, n: string, budget = Infinity, answer = false) {
  const ack: string[] = [];
  for (let round = 0; round < 6; round++) {
    const g = await gate(sb, "--own", n, "--since", `${n}@0`, ...ack);
    const ctx = { ack: answer ? ack : null, budget: round === 0 ? budget : Infinity };
    if (await row(sb, n, g, ctx) === "stop") return lines(g.stdout);
  }
  throw new Error("resume did not settle");
}

type Turn = { ack: string[] | null; budget: number };

/** The first row that matches the gate's lines: "again" reruns the gate, "stop" ends resume. */
async function row(sb: Sandbox, n: string, g: Run, turn: Turn): Promise<"again" | "stop"> {
  const out = lines(g.stdout);
  const own = out.find((l) => l.startsWith("OWN "));
  if (g.code === 0 && out.at(-1) === "gate clear" && !own) return "stop";
  const push = out.filter((l) => l.startsWith("PENDING push "));
  if (push.length) return await pushRow(sb, push, out) ? "again" : "stop";
  if (out.some((l) => l.startsWith(`FENCED closeout ${n} `))) {
    if (!turn.ack) return "stop"; // anything but a yes runs no backlog script
    turn.ack.push("--fence-ack", n);
    return "again";
  }
  if (!own) return "stop";
  const r = await reenter(sb, own, turn.budget);
  return r === "stopped" || r === "held" ? "stop" : "again";
}

/**
 * FR-10: exactly one `PENDING push`, whose diff only deletes the marker's
 * directory and the marker, takes step 4's exit-7 row; false, and nothing is
 * pushed, for anything else — it is someone's work.
 */
async function pushRow(sb: Sandbox, push: string[], out: string[]) {
  if (push.length !== 1 || !(await removalOnly(sb, push[0].split(" ")[2], out))) return false;
  await git(sb.work, "pull", "--quiet", "--rebase", "--no-autostash", "origin", "main");
  const refspec = "refs/heads/main:refs/heads/main";
  await git(sb.work, "push", "--quiet", "--no-follow-tags", "origin", refspec);
  return true;
}

/** Whether <sha>'s diff only deletes the marker and the `<dir>` the gate's closeout line names. */
async function removalOnly(sb: Sandbox, sha: string, out: string[]) {
  const dir = out.find((l) => / closeout /.test(l))?.split(" ")[3];
  const status = (await git(sb.work, "diff", "--no-renames", "--name-status", `${sha}^`, sha))
    .split("\n");
  return status.every((l) =>
    l === "D\t.specnaut/feature.json" || (!!dir && dir !== "-" && l.startsWith(`D\t${dir}/`))
  );
}
