import { dirname, join, resolve } from "@std/path";
import {
  assertSafeDestination,
  type Bundle,
  type MergeJsonFlavor,
  type TemplateFile,
} from "../domain/template.ts";
import {
  assertInsideProject,
  assertLinkTargetInProject,
  assertRemovableInProject,
  resolvedRelative,
  resolveProjectRoot,
} from "./fs_containment.ts";
import { pruneEmptyParents } from "./fs_prune.ts";
import { mergeIntoFile } from "../domain/merge_block.ts";
import { mergeClaudeSettings, pluginDeclarationNotes } from "../domain/claude_settings_merge.ts";
import { type JsonMergeResult, mergeCodexHooks } from "../domain/hook_settings_merge.ts";
import type { BackupReport, ContextLinkWrite, FsWriter } from "../application/ports.ts";
import { backupForDelete, fileExists, isSymlink, readIfExists } from "./fs_backup.ts";
import { denoSymlink, type Linker, writeContextLink } from "./fs_link_writer.ts";

export type { Linker };

type JsonFlavor = {
  readonly merge: (existing: string | null, bundled: string, dest: string) => JsonMergeResult;
  /** What the merge did that the person should hear about. Plugins live in Claude's file only. */
  readonly notes?: (existing: string | null, bundled: string, dest: string) => string[];
};

/** One row per `mergeJson` flavor: a new flavor is a row, never a branch in `writeBundle`. */
const JSON_FLAVORS: Readonly<Record<MergeJsonFlavor, JsonFlavor>> = {
  "claude-settings": { merge: mergeClaudeSettings, notes: pluginDeclarationNotes },
  "codex-hooks": { merge: mergeCodexHooks },
};

/**
 * Merge one user-owned JSON file in place. Written only when the merge changed
 * it, so a no-op run leaves the file — and its mtime — alone, and the caller
 * learns which files moved without diffing them itself.
 */
async function writeJsonMerge(
  abs: string,
  dest: string,
  kind: MergeJsonFlavor,
  bundled: string,
): Promise<{ changed: boolean; notes: string[] }> {
  const flavor = JSON_FLAVORS[kind];
  const existing = await readIfExists(abs);
  const merged = flavor.merge(existing, bundled, dest);
  const notes = flavor.notes?.(existing, bundled, dest) ?? [];
  if (merged.changed) await Deno.writeTextFile(abs, merged.content);
  return { changed: merged.changed, notes };
}

/** What one `writeBundle` run collects, returned as its `BackupReport`. */
type WriteLog = {
  backups: { dest: string; backupPath: string }[];
  skippedSkipIfExists: string[];
  notes: string[];
  mergedChanged: string[];
  links: ContextLinkWrite[];
};

/** The run-wide facts every entry of one `writeBundle` call is written under. */
type EntryRun = {
  readonly root: string;
  readonly overwrite: boolean;
  readonly backupExisting: boolean;
  readonly log: WriteLog;
};

/**
 * PHASE 1 — check every destination, THEN create directories.
 *
 * The ordering is the requirement, not a detail. `Deno.mkdir` with
 * `recursive: true` walks through a symlinked component and creates real
 * directories on the other side, so running it first — which is what this
 * loop used to do, per destination, before anything was checked — is itself an
 * escape. It is also the common path rather than an exotic one: 145 of the 260
 * destinations a real `init` writes are five segments deep.
 *
 * Checking all of them before writing any content also means a refusal never
 * leaves a half-written bundle. It does not make the operation atomic and is
 * not claimed to: cleared destinations keep the directories made for them,
 * which `pruneEmptyParents` already exists to tidy.
 */
async function assertDestinations(bundle: Bundle, resolved: string, root: string) {
  for (const [dest, file] of Object.entries(bundle)) {
    const abs = join(resolved, dest);
    if (file.symlinkTo !== undefined) {
      // A link is REPLACED, never written through, so it is judged as a
      // removal is — the leaf as is. `assertInsideProject` follows the leaf:
      // it reads `AGENTS.md` through our own link, and aborts the whole
      // bundle on a foreign link pointing out, which replacing touches
      // nothing outside. What the new link points at is judged on its own.
      await assertRemovableInProject(root, abs);
      await assertLinkTargetInProject(root, abs, file.symlinkTo);
    } else {
      await assertInsideProject(root, abs);
    }
    await Deno.mkdir(dirname(abs), { recursive: true });
  }
}

/**
 * Whether a `skipIfExists` placeholder is left as the project has it.
 *
 * Written only if absent, unless the caller asked to overwrite: with
 * `overwrite` (`--force` from init, or any upgrade call) the placeholder is
 * treated like an owned file — backed up, then written — which keeps the
 * `upgrade --force` semantics for files init originally created.
 *
 * A project may also have made the dest a symlink — consolidating several
 * context files onto one, then leaving `AGENTS.md` pointing at the survivor;
 * Specnaut's own instructions tell agents to read `AGENTS.md`, so the shape
 * recurs. `Deno.writeTextFile` follows symlinks: a wholesale write would not
 * replace this dest but overwrite whatever the link points at, leaving the
 * link untouched — nothing in a listing changes, and the file destroyed is one
 * nobody asked to touch. Skipped rather than unlinked: breaking a symlink the
 * project made on purpose is its own kind of damage. With `backupExisting` the
 * caller is already safe — `Deno.rename` moves the LINK aside, so the write
 * lands on a fresh regular file and the target survives.
 *
 * Gated on `skipIfExists` on purpose. The managed-section merge builds its own
 * bundle entry without that flag and MUST follow the link, so its fenced
 * section reaches the real file (`upgrade_project.ts`).
 */
async function keepsProjectFile(abs: string, file: TemplateFile, run: EntryRun): Promise<boolean> {
  if (file.skipIfExists !== true) return false;
  if (!run.overwrite && (await fileExists(abs))) return true;
  return !run.backupExisting && (await isSymlink(abs));
}

/** Write a file Specnaut owns: the placeholder rule, then backup, content and mode. */
async function writeOwnedFile(abs: string, dest: string, file: TemplateFile, run: EntryRun) {
  if (await keepsProjectFile(abs, file, run)) {
    run.log.skippedSkipIfExists.push(dest);
    return;
  }
  if (run.backupExisting && (await fileExists(abs))) {
    run.log.backups.push(await backupForDelete(abs, dest));
  }
  await Deno.writeTextFile(abs, file.content);
  if (file.executable && Deno.build.os !== "windows") {
    // Re-asserted rather than inherited from phase 1. `chmod` is its own
    // syscall on the same path and it follows a leaf symlink exactly as
    // `writeTextFile` does — and phase 1's verdict was taken before this run
    // created anything, so a destination that became a link in between has
    // not been judged. Cheap, and the alternative is a mode change on a file
    // outside the project.
    await assertInsideProject(run.root, abs);
    await Deno.chmod(abs, 0o755);
  }
}

export class DenoFsWriter implements FsWriter {
  /**
   * @param linker how a symlink is made. A constructor seam rather than a
   *   port: the application never decides HOW a link is made, only that one
   *   is wanted, and a refusing system is an infrastructure fact.
   */
  constructor(private readonly linker: Linker = denoSymlink) {}

  async detectConflicts(bundle: Bundle, targetDir: string): Promise<string[]> {
    const conflicts: string[] = [];
    const resolved = resolve(targetDir);
    for (const [dest, file] of Object.entries(bundle)) {
      assertSafeDestination(dest);
      // Mergeable files merge non-destructively into any pre-existing content,
      // so they are never conflicts.
      if (file.mergeBlock !== undefined) continue;
      // JSON-merged files (e.g. `.claude/settings.json`) are also merged
      // structurally into any pre-existing user content — never a conflict.
      if (file.mergeJson !== undefined) continue;
      // Skip-if-exists files (placeholders like AGENTS.md) silently leave
      // the user's existing file alone — also never a conflict.
      if (file.skipIfExists === true) continue;
      const abs = join(resolved, dest);
      if (await fileExists(abs)) conflicts.push(dest);
    }
    return conflicts.sort();
  }

  async writeBundle(
    bundle: Bundle,
    targetDir: string,
    options: { overwrite?: boolean; backupExisting?: boolean },
  ): Promise<BackupReport> {
    const resolved = resolve(targetDir);
    for (const dest of Object.keys(bundle)) assertSafeDestination(dest);
    const root = await resolveProjectRoot(resolved);
    const run: EntryRun = {
      root,
      overwrite: options.overwrite ?? false,
      backupExisting: options.backupExisting ?? false,
      log: { backups: [], skippedSkipIfExists: [], notes: [], mergedChanged: [], links: [] },
    };

    if (!run.overwrite) {
      const conflicts = await this.detectConflicts(bundle, resolved);
      if (conflicts.length > 0) {
        throw new Error(
          `Target directory already contains ${conflicts.length} file(s) specnaut manages:\n` +
            conflicts.map((c) => `  - ${c}`).join("\n"),
        );
      }
    }

    await assertDestinations(bundle, resolved, root);
    for (const [dest, file] of Object.entries(bundle)) {
      await this.writeEntry(join(resolved, dest), dest, file, run);
    }

    const { backups, skippedSkipIfExists, notes, mergedChanged, links } = run.log;
    return {
      backups,
      skippedSkipIfExists,
      ...(notes.length > 0 ? { notes } : {}),
      ...(mergedChanged.length > 0 ? { mergedChanged } : {}),
      ...(links.length > 0 ? { links } : {}),
    };
  }

  /**
   * PHASE 2 — write one entry, by kind: a context link, a fenced-block merge, a
   * JSON merge, or a file Specnaut owns.
   *
   * Mergeable files (block or JSON) are never backed up: the merge is
   * non-destructive, and a backup of an unchanged user file is noise. They also
   * bypass the overwrite/conflict path entirely. The JSON splice is structured
   * (per flavor) rather than a fenced text block.
   */
  private async writeEntry(abs: string, dest: string, file: TemplateFile, run: EntryRun) {
    if (file.symlinkTo !== undefined) {
      const made = await writeContextLink(
        this.linker,
        abs,
        dest,
        file,
        file.symlinkTo,
        run.backupExisting,
      );
      if (made.backup) run.log.backups.push(made.backup);
      if (made.link) run.log.links.push(made.link);
    } else if (file.mergeBlock !== undefined) {
      const existing = await readIfExists(abs);
      await Deno.writeTextFile(abs, mergeIntoFile(existing, file.content, file.mergeBlock));
    } else if (file.mergeJson !== undefined) {
      const merged = await writeJsonMerge(abs, dest, file.mergeJson, file.content);
      run.log.notes.push(...merged.notes);
      if (merged.changed) run.log.mergedChanged.push(dest);
    } else {
      await writeOwnedFile(abs, dest, file, run);
    }
  }

  async deletePaths(
    paths: ReadonlyArray<string>,
    targetDir: string,
    options: { backupExisting: boolean; within?: (resolvedRel: string) => boolean },
  ): Promise<BackupReport> {
    const resolved = resolve(targetDir);
    const root = await resolveProjectRoot(resolved);
    const backups: { dest: string; backupPath: string }[] = [];
    const emptied = new Set<string>();
    const refused: string[] = [];

    for (const dest of paths) {
      assertSafeDestination(dest);
      const abs = join(resolved, dest);
      if (!(await fileExists(abs))) continue;
      // Before the rename AND before the remove. `Deno.remove` and
      // `Deno.rename` operate on the LINK rather than its target, so neither
      // reaches outside on its own — but the path may cross a symlinked
      // ANCESTOR, and then both do. Measured: with `.claude/` a link out,
      // `deletePaths` deleted the file at the target. Judged on what they act
      // on, the leaf as is (cli#669).
      await assertRemovableInProject(root, abs);
      // Inside the project is not enough when the caller bounds WHERE (cli#665):
      // a committed link under an allowed folder can lead anywhere else in it.
      if (options.within && !options.within(await resolvedRelative(root, abs))) {
        refused.push(dest);
        continue;
      }

      if (options.backupExisting) backups.push(await backupForDelete(abs, dest));
      else {
        await Deno.remove(abs);
        emptied.add(dirname(abs));
      }
    }

    // After every delete, not during: two files removed from the same
    // directory must not have the first one's prune decide for the second.
    const notes: string[] = [];
    for (const dir of emptied) await pruneEmptyParents(dir, resolved, notes);
    return { backups, skippedSkipIfExists: [], refused, notes };
  }
}
