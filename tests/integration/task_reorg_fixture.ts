import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join, relative, SEPARATOR } from "@std/path";
import { findHarness } from "../../src/cli/harnesses.ts";
import { destResolver } from "../../src/application/upgrade_renames.ts";
import { bundleOptionsOf } from "../../src/application/upgrade_lock.ts";
import { parseLock, serializeLock } from "../../src/domain/installed_lock.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";
import {
  renameEndpointEntry,
  routerEndpointEntry,
  SKILL_DOC_RENAMES,
  type SkillDocRename,
} from "../../src/domain/skill_doc_renames.ts";

/**
 * Spec 037 — a 7.1 project upgrades into `/task` without losing a customised
 * doc, an addendum, or a file Specnaut never wrote. This is the 7.1 project the
 * `upgrade_task_reorg_*_test.ts` files upgrade, one file per scenario (cli#702),
 * and the probes they read it with.
 *
 * Every path is resolved through the harness and the rename table, never
 * spelled: a literal would be a second move list (plan § 5). As in
 * `upgrade_renamed_docs_test.ts`, assertions are on CONTENT at the address the
 * agent now reads — existence alone passes against the silent failure.
 */

export const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

export const HARNESSES = ["claude", "codex", "copilot"] as const;
export type Ai = typeof HARNESSES[number];

/** Strings only the planted files can produce. Invented; they name nothing real. */
export const USER_EDIT = "HOUSE RULE — never merge on a Friday, do not remove";
export const ADDENDUM =
  "Before step 3, run `./scripts/check-pending-migrations.sh`.\r\nStop if it fails.\n";
export const SECRET = "API_TOKEN=s3cr3t-do-not-copy";

export async function runSpecnaut(args: string[], cwd: string) {
  const { code, stdout, stderr } = await new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", MAIN, ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-task-reorg-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

export async function write(dir: string, rel: string, content: string): Promise<void> {
  await Deno.mkdir(dirname(join(dir, rel)), { recursive: true });
  await Deno.writeTextFile(join(dir, rel), content);
}

export const entry = (category: CoreEntry["category"], name: string): CoreEntry => ({
  category,
  name,
  suffix: null,
  content: "",
  executable: false,
});

/** One spec-037 move as it lands on this harness, with the bytes planted at its old address. */
export type Move = { row: SkillDocRename; oldDest: string; newDest: string; planted: string };

/**
 * A project as 7.1 left it: every spec-037 doc at its old address, on disk and
 * in the lock, the new address absent from both; the lock stamped 7.1.0.
 * `customise` names the docs (by file name) whose bytes diverge from the lock;
 * `crlf` writes those customised docs with CRLF line endings, as a Windows
 * checkout with `core.autocrlf` would.
 */
export async function projectOn71(
  dir: string,
  ai: Ai,
  opts: { customise?: ReadonlyArray<string>; crlf?: boolean; customiseRouter?: boolean } = {},
): Promise<{ moves: Move[]; dest: (e: CoreEntry) => string }> {
  const init = await runSpecnaut(
    ["init", "--here", "--no-git", "--ai", ai, "--backlog", "local"],
    dir,
  );
  assertEquals(init.code, 0, `init failed: ${init.stderr}`);

  const lockPath = join(dir, ".specnaut/installed.lock");
  const lock = parseLock(await Deno.readTextFile(lockPath));
  const resolve = destResolver(findHarness(ai)!, bundleOptionsOf(lock));
  const dest = (e: CoreEntry) => resolve(e)!;
  const entries = new Map(lock.entries);

  const moves: Move[] = [];
  for (const row of SKILL_DOC_RENAMES.filter((r) => r.to.owner === "task")) {
    const oldDest = dest(renameEndpointEntry(row.from.owner, row.from.doc, row.kind));
    const newDest = dest(renameEndpointEntry(row.to.owner, row.to.doc, row.kind));
    const tracked = entries.get(newDest);
    if (tracked === undefined) continue; // not installed for this backend
    const vanilla = await Deno.readTextFile(join(dir, newDest));
    const custom = opts.customise?.includes(row.to.doc) === true;
    const edited = custom ? `${vanilla}\n${USER_EDIT}\n` : vanilla;
    const planted = custom && opts.crlf ? edited.replaceAll("\n", "\r\n") : edited;
    await write(dir, oldDest, planted);
    await Deno.remove(join(dir, newDest));
    entries.delete(newDest);
    entries.set(oldDest, { ...tracked, sha256: await sha256(vanilla) });
    moves.push({ row, oldDest, newDest, planted });
  }
  // The floor is the rename table (cli#709): every phase row resolves, whatever the backend.
  const unresolved = SKILL_DOC_RENAMES.filter((r) =>
    r.to.owner === "task" && r.kind !== "backlog-doc"
  )
    .filter((r) => !moves.some((m) => m.row === r)).map((r) => r.to.doc);
  assertEquals(unresolved, [], "phase moves the fixture did not resolve — it is not a 7.1 tree");

  if (opts.customiseRouter) {
    const router = dest(routerEndpointEntry("specnaut"));
    await Deno.writeTextFile(
      join(dir, router),
      `${await Deno.readTextFile(join(dir, router))}\n${USER_EDIT}\n`,
    );
  }

  const aged = new Map([...entries].map(([d, e]) => [d, { ...e, templatesVersion: "7.1.0" }]));
  await Deno.writeTextFile(
    lockPath,
    serializeLock({ ...lock, templatesVersion: "7.1.0", entries: aged }),
  );
  return { moves, dest };
}

/** Plants a retired skill's router at its 7.1 address, customised and tracked. */
export async function plantRetired(dir: string, rel: string): Promise<void> {
  const vanilla = "---\nname: retired\n---\n\n# Retired router\n";
  await write(dir, rel, `${vanilla}\n${USER_EDIT}\n`);
  const lockPath = join(dir, ".specnaut/installed.lock");
  const lock = parseLock(await Deno.readTextFile(lockPath));
  const entries = new Map(lock.entries);
  entries.set(rel, {
    sha256: await sha256(vanilla),
    installedAt: "2026-01-01T00:00:00Z",
    templatesVersion: "7.1.0",
  });
  await Deno.writeTextFile(lockPath, serializeLock({ ...lock, entries }));
}

/** Every file under `dir`, `/`-separated, with its content — the whole observable tree. */
export async function snapshot(dir: string, at = dir, out = new Map<string, string>()) {
  for await (const e of Deno.readDir(at)) {
    const abs = join(at, e.name);
    if (e.isDirectory) await snapshot(dir, abs, out);
    else out.set(relative(dir, abs).split(SEPARATOR).join("/"), await Deno.readTextFile(abs));
  }
  return out;
}

/**
 * `rel` holds exactly `text`, compared as bytes: a decode would hide a dropped
 * BOM or a CRLF rewritten to LF, the two ways a "moved" file stops being the file.
 */
export async function assertBytes(dir: string, rel: string, text: string, msg?: string) {
  assertEquals(await Deno.readFile(join(dir, rel)), new TextEncoder().encode(text), msg ?? rel);
}

export const addendum = (skill: string, phase: string) => `.specnaut/addenda/${skill}/${phase}.md`;
export const find = (moves: Move[], doc: string) => moves.find((m) => m.row.to.doc === doc)!;
