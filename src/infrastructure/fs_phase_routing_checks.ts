import { join } from "@std/path";
import {
  ADDENDA_ROOT,
  ADDENDUM_SKILLS,
  type AddendumFinding,
  addendumPath,
  auditAddendum,
} from "../domain/addendum_audit.ts";
import type { CheckOutcome } from "../domain/check_result.ts";
import { type InstalledLock, parseLock } from "../domain/installed_lock.ts";
import { sha256Hex } from "../domain/sha256.ts";
import { predatesPhaseMove, staleRouterAdvice } from "../domain/skill_doc_renames.ts";

/**
 * `check --project` rows for a phase customisation no router reads any more:
 * an addendum at an address no router reads (#622), and a customised router
 * that still routes to the phases' old addresses (spec 037). Both are a
 * guardrail silently off, so both are `warn` — the project works, the rule
 * written into it does not.
 *
 * Out of `fs_project_inspector.ts`, which had passed its size ceiling.
 */

/**
 * Every non-directory entry under `root`, as `/`-separated paths relative to
 * it. Symlinks count as files: a router reads through them. Which of these
 * matter is the domain's call (`auditAddendum`), not the walker's.
 */
async function listFilesUnder(root: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(join(root, prefix))) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory) files.push(...await listFilesUnder(root, rel));
    else files.push(rel);
  }
  return files;
}

/** Why the router never reads this file, and where the text should live. */
function describeAddendumFinding(f: AddendumFinding): string {
  const hint = f.suggestion ? `; did you mean ${addendumPath(f.suggestion)}?` : "";
  const unread = "never read";
  switch (f.problem.kind) {
    case "unknown-phase":
      return `names no /${f.problem.skill} phase — ${unread}${hint}`;
    case "renamed":
      return `phase renamed (${f.problem.reason}) — ${unread}${
        f.suggestion ? `; move it to ${addendumPath(f.suggestion)}` : ""
      }`;
    case "contract-doc":
      return `contract doc, not a phase — no addendum is read for it; name its step in ${
        f.problem.parents.map(addendumPath).join(" or ")
      }`;
    case "unknown-skill":
      return `\`${f.problem.skill}\` is not a skill that reads addenda (${
        ADDENDUM_SKILLS.join(", ")
      }) — ${unread}${hint}`;
    case "wrong-depth":
      return `not at ${ADDENDA_ROOT}/<skill>/<phase>.md — ${unread}${hint}`;
    case "not-markdown":
      return `not a .md file — ${unread}${hint}`;
  }
}

/**
 * Lists every file under `.specnaut/addenda/` that no router will ever read
 * (#622) — a mistyped phase, a phase renamed by an upgrade, a contract doc, a
 * wrong directory. Each is a `warn`: the project still works, but an
 * addendum written as a guardrail is silently off, and nothing else says so.
 *
 * Silent when the directory is absent or every addendum is valid — a
 * project that never wrote one should not be told how many it has.
 */
export async function checkAddenda(projectDir: string): Promise<CheckOutcome[]> {
  const root = join(projectDir, ADDENDA_ROOT);
  let files: string[];
  try {
    files = await listFilesUnder(root);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    if (err instanceof Deno.errors.NotADirectory) {
      return [{
        name: `${ADDENDA_ROOT}/`,
        status: "warn",
        message: `not a directory — addenda are ${ADDENDA_ROOT}/<skill>/<phase>.md`,
      }];
    }
    throw err;
  }
  return files
    .sort()
    .map(auditAddendum)
    .filter((f): f is AddendumFinding => f !== null)
    .map((f) => ({
      name: `${ADDENDA_ROOT}/${f.path}`,
      status: "warn" as const,
      message: describeAddendumFinding(f),
    }));
}

/**
 * Names the router the phases left (`specnaut/SKILL.md` on Claude) when the
 * project customised it before the move: `upgrade` keeps it like any
 * customisation, and it keeps routing to `phases/plan.md` and the rest, which
 * are gone. Said on every check, not just the upgrade that kept it, until its
 * baseline is re-taken (`reconcile`, `--force`) at or after the move.
 *
 * Silent without a lock: nothing is tracked to compare with. A lock that will
 * not parse is the harness check's to report, once, rather than every check's.
 */
export async function checkStaleRouter(
  projectDir: string,
  routerDest: (lock: InstalledLock) => string | null,
): Promise<CheckOutcome[]> {
  const lock = await readLock(projectDir);
  const dest = lock === null ? null : routerDest(lock);
  const entry = dest === null ? undefined : lock?.entries.get(dest);
  if (dest === null || entry === undefined || !predatesPhaseMove(entry.templatesVersion)) {
    return [];
  }
  const content = await readOrNull(join(projectDir, dest));
  if (content === null || await sha256Hex(content) === entry.sha256) return [];
  return [{ name: dest, status: "warn", message: staleRouterAdvice(dest) }];
}

async function readLock(projectDir: string): Promise<InstalledLock | null> {
  const raw = await readOrNull(join(projectDir, ".specnaut/installed.lock"));
  if (raw === null) return null;
  try {
    return parseLock(raw);
  } catch (err) {
    // Reported by this same run's harness row (`lockFailure`), once; a second
    // row here would say it twice. Anything that is not an Error is not a parse.
    if (!(err instanceof Error)) throw err;
    return null;
  }
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}
