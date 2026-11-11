import { join } from "@std/path";
import { git, type Sandbox } from "./git_sandbox.ts";

/** cli#760 — the published bases the intake gate's tests build (_intake_gate.sh). */

export const DIR = ".specnaut/specs/001-x";
export const lines = (out: string) => out.trim().split("\n");
export const gate = (sb: Sandbox, ...args: string[]) =>
  sb.script("wip-audit.sh", "--gate", ...args);

/** A landing as `merge` leaves it: the spec, its marker, and the squashed commit, pushed. */
export async function land(sb: Sandbox, json: string, subject: string, ...body: string[]) {
  await Deno.mkdir(join(sb.work, DIR), { recursive: true });
  await Deno.writeTextFile(join(sb.work, DIR, "plan.md"), "# plan\n");
  // A tracked tree under the directory: a nested feature_directory names a real tree.
  await Deno.mkdir(join(sb.work, DIR, "deeper"), { recursive: true });
  await Deno.writeTextFile(join(sb.work, DIR, "deeper", "notes.md"), "notes\n");
  await git(sb.work, "add", DIR);
  const sha = await sb.commit(".specnaut/feature.json", json, subject, ...body);
  await git(sb.work, "push", "--quiet", "origin", "main");
  return sha;
}

/** What remove-spec.sh commits: the directory and the marker, nothing outside .specnaut/. */
export async function settle(sb: Sandbox) {
  await git(sb.work, "rm", "-r", "--quiet", "--", DIR, ".specnaut/feature.json");
  await git(sb.work, "commit", "--quiet", "-m", "chore(1): remove the spec directory");
  await git(sb.work, "push", "--quiet", "origin", "main");
}

export const marker = (n: number | string, extra = "") =>
  `{ "feature_directory": "${DIR}", "linked_issue": ${n}${extra} }\n`;
