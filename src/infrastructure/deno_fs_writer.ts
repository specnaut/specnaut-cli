import { dirname, join, resolve } from "@std/path";
import { assertSafeDestination, type Bundle } from "../domain/template.ts";
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
import type { BackupReport, ContextLinkWrite, FsWriter } from "../application/ports.ts";
import type { TemplateFile } from "../domain/template.ts";
import { linkTargetPath } from "../domain/context_link.ts";

const BACKUP_SUFFIX = ".specnaut.bak";

/** Move `abs` aside instead of deleting it, and say what was moved. */
async function backupForDelete(abs: string, dest: string) {
  const wasSymlink = await isSymlink(abs);
  const suffix = await backupAside(abs);
  return {
    dest,
    backupPath: `${dest}${suffix}`,
    ...(wasSymlink ? { wasSymlink: true as const } : {}),
  };
}

/** Whether `path` is itself a symlink — `lstat`, never `stat`. */
async function isSymlink(path: string): Promise<boolean> {
  try {
    return (await Deno.lstat(path)).isSymlink;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

/**
 * Moves `abs` aside to a backup that destroys nothing, and returns the suffix
 * that was actually used.
 *
 * `Deno.rename` overwrites its destination silently, so a second backup of the
 * same path erased the first. That is not a tidiness problem: switching backlog
 * backend `local → github → local → github` backed up the user's real
 * `.specnaut/backlog.md` on the first switch and then overwrote that backup
 * with the freshly-scaffolded template on the third. Same shape for a repeated
 * `--force`: run one saves the user's edits, run two replaces them with the
 * bundle content the force had just written. Every path here is reached
 * BECAUSE a file was about to be destroyed, so the one thing this must never
 * do is destroy the record of the last time.
 *
 * The rolled names keep the `.specnaut.bak` tail (`x.2.specnaut.bak`, not
 * `x.specnaut.bak.2`) because the scaffolded `.gitignore` ignores
 * `*.specnaut.bak` — a suffix appended after it would be committed.
 */
async function backupAside(abs: string): Promise<string> {
  let suffix = BACKUP_SUFFIX;
  for (let n = 2; await fileExists(`${abs}${suffix}`); n++) {
    suffix = `.${n}${BACKUP_SUFFIX}`;
  }
  await Deno.rename(abs, `${abs}${suffix}`);
  return suffix;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}

/** Makes the symlink at `path` reading `target`. The seam a test fakes a refusal through. */
export type Linker = (target: string, path: string) => Promise<void>;

/**
 * `Deno.symlink`, with the Windows details a context link needs: `type:
 * "file"` (Windows links are typed and Deno cannot infer a missing target's
 * type), and the target in `\` form, which is what Windows itself writes.
 */
function denoSymlink(target: string, path: string): Promise<void> {
  const text = Deno.build.os === "windows" ? target.replaceAll("/", "\\") : target;
  return Deno.symlink(text, path, { type: "file" });
}

/**
 * Errors that are not "this system cannot make links here" and so must not
 * fall back. `NotCapable` is Deno refusing a permission the binary was not
 * granted; `AlreadyExists` is a race with something else writing the path;
 * `NotFound` is a parent directory that should exist and does not. Every
 * other error falls back — a deny-list, because Windows reports a missing
 * symlink privilege (error 1314) as `PermissionDenied` or as a generic error
 * depending on the build, and init must never fail over a convenience link.
 */
const NOT_A_LINK_REFUSAL = [
  Deno.errors.NotCapable,
  Deno.errors.AlreadyExists,
  Deno.errors.NotFound,
];

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
    const overwrite = options.overwrite ?? false;
    const backupExisting = options.backupExisting ?? false;
    const resolved = resolve(targetDir);

    for (const dest of Object.keys(bundle)) assertSafeDestination(dest);
    const root = await resolveProjectRoot(resolved);

    if (!overwrite) {
      const conflicts = await this.detectConflicts(bundle, resolved);
      if (conflicts.length > 0) {
        throw new Error(
          `Target directory already contains ${conflicts.length} file(s) specnaut manages:\n` +
            conflicts.map((c) => `  - ${c}`).join("\n"),
        );
      }
    }

    const backups: { dest: string; backupPath: string }[] = [];
    const skippedSkipIfExists: string[] = [];
    const notes: string[] = [];
    const links: ContextLinkWrite[] = [];

    // PHASE 1 — check every destination, THEN create directories.
    //
    // The ordering is the requirement, not a detail. `Deno.mkdir` with
    // `recursive: true` walks through a symlinked component and creates real
    // directories on the other side, so running it first — which is what this
    // loop used to do, per destination, before anything was checked — is
    // itself an escape. It is also the common path rather than an exotic one:
    // 145 of the 260 destinations a real `init` writes are five segments deep.
    //
    // Checking all of them before writing any content also means a refusal
    // never leaves a half-written bundle. It does not make the operation
    // atomic and is not claimed to: cleared destinations keep the directories
    // made for them, which `pruneEmptyParents` already exists to tidy.
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

    // PHASE 2 — write.
    for (const [dest, file] of Object.entries(bundle)) {
      const abs = join(resolved, dest);

      if (file.symlinkTo !== undefined) {
        const made = await this.writeLink(abs, dest, file, file.symlinkTo, backupExisting);
        if (made.backup) backups.push(made.backup);
        if (made.link) links.push(made.link);
        continue;
      }

      // Mergeable files are never backed up: merge is non-destructive and
      // writing a backup of an unchanged user file is noisy. They also
      // bypass the overwrite/conflict path entirely.
      if (file.mergeBlock !== undefined) {
        const existing = await readIfExists(abs);
        const merged = mergeIntoFile(existing, file.content, file.mergeBlock);
        await Deno.writeTextFile(abs, merged);
        continue;
      }

      // JSON-merged files: same non-destructive contract as mergeBlock,
      // but the splice rule is structured (per-flavor) rather than a
      // fenced text block.
      if (file.mergeJson !== undefined) {
        const existing = await readIfExists(abs);
        // Currently only one flavor — switch when more land.
        const merged = mergeClaudeSettings(existing, file.content, dest);
        notes.push(...pluginDeclarationNotes(existing, file.content, dest));
        await Deno.writeTextFile(abs, merged);
        continue;
      }

      // Skip-if-exists placeholders: only write if the file is absent
      // AND the caller didn't request overwrite. With overwrite=true
      // (i.e. `--force` from init or any upgrade call), the placeholder
      // is treated like an owned file: the existing content is backed
      // up and the bundle content is written. This preserves the
      // existing `upgrade --force` semantics for files that init
      // originally created (lock-tracked → standard upgrade path).
      if (
        file.skipIfExists === true && !overwrite && (await fileExists(abs))
      ) {
        skippedSkipIfExists.push(dest);
        continue;
      }

      // A `skipIfExists` dest belongs to the project, and a project may have
      // made it a symlink — consolidating several context files onto one, then
      // leaving `AGENTS.md` pointing at the survivor, is a reasonable thing to
      // do, and Specnaut's own instructions tell agents to read `AGENTS.md`, so
      // the shape recurs.
      //
      // `Deno.writeTextFile` follows symlinks. A wholesale write would not
      // replace this dest: it would overwrite whatever the link points at, and
      // leave the link untouched afterwards — same name, same mode, same target.
      // Nothing in a directory listing changes, and the file destroyed is a
      // different one nobody asked to touch.
      //
      // Skipped rather than unlinked: breaking a symlink the project made on
      // purpose is its own kind of damage. When `backupExisting` is set the
      // caller is already safe — `Deno.rename` moves the LINK aside, so the
      // write lands on a fresh regular file and the target survives.
      //
      // Gated on `skipIfExists` on purpose. The managed-section merge builds its
      // own bundle entry without that flag and MUST follow the link, so its
      // fenced section reaches the real file (`upgrade_project.ts`).
      if (
        file.skipIfExists === true && !backupExisting &&
        (await isSymlink(abs))
      ) {
        skippedSkipIfExists.push(dest);
        continue;
      }

      if (backupExisting && (await fileExists(abs))) {
        // Read BEFORE the rename — afterwards there is nothing at `abs` to ask.
        const wasSymlink = await isSymlink(abs);
        const suffix = await backupAside(abs);
        backups.push({
          dest,
          backupPath: `${dest}${suffix}`,
          ...(wasSymlink ? { wasSymlink: true as const } : {}),
        });
      }

      await Deno.writeTextFile(abs, file.content);
      if (file.executable && Deno.build.os !== "windows") {
        // Re-asserted rather than inherited from phase 1. `chmod` is its own
        // syscall on the same path and it follows a leaf symlink exactly as
        // `writeTextFile` does — and phase 1's verdict was taken before this
        // run created anything, so a destination that became a link in between
        // has not been judged. Cheap, and the alternative is a mode change on
        // a file outside the project.
        await assertInsideProject(root, abs);
        await Deno.chmod(abs, 0o755);
      }
    }

    return {
      backups,
      skippedSkipIfExists,
      ...(notes.length > 0 ? { notes } : {}),
      ...(links.length > 0 ? { links } : {}),
    };
  }

  /**
   * Put a context link at `abs`. Our own link already there is left alone —
   * even under `backupExisting`, or every forced run would back up its own
   * link. Anything else there is moved aside (`backupExisting`) or removed:
   * the caller decided it may go. Then the link, or the fallback file when
   * the system refuses links.
   */
  private async writeLink(
    abs: string,
    dest: string,
    file: TemplateFile,
    target: string,
    backupExisting: boolean,
  ): Promise<{ backup?: BackupReport["backups"][number]; link?: ContextLinkWrite }> {
    if (await isSymlink(abs)) {
      const current = await Deno.readLink(abs);
      if (linkTargetPath(dest, current) === linkTargetPath(dest, target)) return {};
    }
    let backup: BackupReport["backups"][number] | undefined;
    if (await fileExists(abs)) {
      if (backupExisting) backup = await backupForDelete(abs, dest);
      else await Deno.remove(abs);
    }
    try {
      await this.linker(target, abs);
      return { backup, link: { dest, target, form: "symlink" } };
    } catch (err) {
      if (NOT_A_LINK_REFUSAL.some((e) => err instanceof e)) throw err;
      const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      await Deno.writeTextFile(abs, file.content);
      return { backup, link: { dest, target, form: "fallback", reason } };
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
