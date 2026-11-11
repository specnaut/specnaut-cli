import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { git, run, type Sandbox, sandbox } from "./git_sandbox.ts";

/**
 * cli#760 — the agent's half of a closeout re-entered from the intake gate's
 * line, on the local backend with the real scripts (closeout_resume_test.ts):
 * it reads only the gate's line and the exits, never feature.json, and stops
 * wherever merge-close.md and resume.md say it stops.
 */

const LOCAL = fromFileUrl(new URL("../../templates/core/skills/task/scripts/", import.meta.url));
export const DIR = ".specnaut/specs/001-x";
export const lines = (out: string) => out.trim().split("\n");

/** A sandbox with the local backend installed and a backlog the tree ignores. */
export async function project(items: Record<string, { status: string; parent?: string }>) {
  const sb = await sandbox();
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
  await Deno.mkdir(join(sb.work, ".specnaut/backlog"), { recursive: true });
  for (const [n, { status, parent }] of Object.entries(items)) {
    const pad = n.padStart(3, "0");
    await Deno.writeTextFile(
      join(sb.work, `.specnaut/backlog/${pad}-item.md`),
      `---\nnumber: ${n}\ntitle: Item ${n}\nstatus: ${status}\n${
        parent ? `parent: "#${parent}"\n` : ""
      }---\n\nBody.\n`,
    );
  }
  return sb;
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
  const shipped: string[] = [];
  if (kind === "closeout") {
    const landed = (await sb.script("epic-status.sh", "--landed", `${n}@0`)).stdout;
    const kids = new Set(lines((await backlog(sb, "cascade-check.sh", "--numbers", n)).stdout));
    const children = [...landed.matchAll(/^CHILD T\d+ #(\d+) /gm)].map((c) => c[1]).filter((c) =>
      kids.has(c)
    );
    for (const item of [...children, n]) {
      if (spend()) return "interrupted";
      const cc = (await backlog(sb, "cascade-check.sh", item)).code;
      if (cc === 11 || cc === 3) return "stopped";
      if (cc !== 0 && cc !== 12) throw new Error(`cascade-check ${item}: ${cc}`);
      if (spend()) return "interrupted";
      // Local: the close is close-shipped.sh for that item, before the next item's check.
      const cs = (await backlog(sb, "close-shipped.sh", item)).code;
      if (cs === 20) return "held";
      shipped.push(item);
    }
  }
  if (spend()) return "interrupted";
  const rm = dir === "-"
    ? await sb.script("remove-spec.sh", "--marker-only", n)
    : await sb.script("remove-spec.sh", dir.split("/").at(-1)!);
  if (rm.code === 7) return "unpushed";
  assertEquals(rm.code, 0, rm.stderr);
  return "removed";
}

/** resume.md's rows, until the gate is clear: the (P) row, then the closeout row. */
export async function resume(sb: Sandbox, n: string, budget = Infinity) {
  for (let round = 0; round < 6; round++) {
    const g = await gate(sb, "--own", n, "--since", `${n}@0`);
    const out = lines(g.stdout);
    if (g.code === 0 && out.at(-1) === "gate clear" && !out.some((l) => l.startsWith("OWN "))) {
      return out;
    }
    const push = out.filter((l) => l.startsWith("PENDING push "));
    if (push.length) {
      // FR-10: one local commit that only deletes the marker and its directory — step 4's exit-7 row.
      assertEquals(push.length, 1, out.join("\n"));
      await git(sb.work, "pull", "--quiet", "--rebase", "--no-autostash", "origin", "main");
      await git(
        sb.work,
        "push",
        "--quiet",
        "--no-follow-tags",
        "origin",
        "refs/heads/main:refs/heads/main",
      );
      continue;
    }
    const own = out.find((l) => l.startsWith("OWN "));
    if (!own) return out;
    const r = await reenter(sb, own, round === 0 ? budget : Infinity);
    if (r === "stopped" || r === "held") return out;
  }
  throw new Error("resume did not settle");
}
