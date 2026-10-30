import type { BackupReport, ContextLinkWrite } from "../application/ports.ts";
import type { TemplateFile } from "../domain/template.ts";
import { isOurFallbackText, isOurLinkText } from "../domain/context_link.ts";
import { backupForDelete, fileExists, isSymlink } from "./fs_backup.ts";

/**
 * Writing a context link (cli#680, cli#681): the symlink, or — where the system
 * refuses links — the one-line fallback file. Called by `DenoFsWriter` after
 * its phase 1 has judged the link's own path removable and its target inside
 * the project.
 */

/** Makes the symlink at `path` reading `target`. The seam a test fakes a refusal through. */
export type Linker = (target: string, path: string) => Promise<void>;

/**
 * `Deno.symlink`, with the Windows details a context link needs: `type:
 * "file"` (Windows links are typed and Deno cannot infer a missing target's
 * type), and the target in `\` form, which is what Windows itself writes.
 */
export function denoSymlink(target: string, path: string): Promise<void> {
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

/**
 * Put a context link at `abs`. Our own link already there is left alone —
 * even under `backupExisting`, or every forced run would back up its own
 * link. Our own fallback file is removed without a backup for the same reason
 * (cli#687): where links are refused it is rewritten on every forced run.
 * Anything else there is moved aside (`backupExisting`) or removed: the caller
 * decided it may go. Then the link, or the fallback file when the system
 * refuses links.
 */
export async function writeContextLink(
  linker: Linker,
  abs: string,
  dest: string,
  file: TemplateFile,
  target: string,
  backupExisting: boolean,
): Promise<{ backup?: BackupReport["backups"][number]; link?: ContextLinkWrite }> {
  if (await isSymlink(abs)) {
    const current = await Deno.readLink(abs);
    if (isOurLinkText(current, target, Deno.build.os === "windows")) return {};
  }
  let backup: BackupReport["backups"][number] | undefined;
  if (await fileExists(abs)) {
    if (backupExisting && !(await holdsOurFallback(abs, file.content))) {
      backup = await backupForDelete(abs, dest);
    } else await Deno.remove(abs);
  }
  try {
    await linker(target, abs);
    return { backup, link: { dest, target, form: "symlink" } };
  } catch (err) {
    if (NOT_A_LINK_REFUSAL.some((e) => err instanceof e)) throw err;
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    await Deno.writeTextFile(abs, file.content);
    return { backup, link: { dest, target, form: "fallback", reason } };
  }
}

/** Whether `abs` is a regular file holding our fallback — never read through a link. */
async function holdsOurFallback(abs: string, fallback: string): Promise<boolean> {
  if (!(await Deno.lstat(abs)).isFile) return false;
  return isOurFallbackText(await Deno.readTextFile(abs), fallback);
}
