import type { FsReader } from "./ports.ts";
import { sha256Hex } from "../domain/sha256.ts";
import { type LinkEvidence, linkIdentity, linkTargetPath } from "../domain/context_link.ts";

/**
 * What `classifyLinkDisk` is told about one context-link destination, read the
 * one way `diff` and `upgrade` must both read it (cli#693).
 *
 * The two used to gather it separately and had drifted: for a symlink,
 * `upgrade` hashed `linkIdentity(target)` while `diff` passed no sha at all.
 * Harmless only while the classifier ignores the sha of a link — one change to
 * it, and the two commands would disagree about the same file.
 *
 * Read with `readEntry`, never `readText`: through the link `readText` reads
 * `AGENTS.md`, and through a foreign link pointing out of the project it throws.
 * A symlink is hashed by its identity, the string `installed.lock` records for
 * a link whichever form was written.
 */
export async function gatherLinkEvidence(
  reader: FsReader,
  projectDir: string,
  dest: string,
  symlinkTo: string,
  lockSha: string | undefined,
): Promise<LinkEvidence> {
  const disk = await reader.readEntry(projectDir, dest);
  const diskSha = disk === null
    ? undefined
    : await sha256Hex(disk.kind === "file" ? disk.content : linkIdentity(disk.target));
  const targetEntry = await reader.readEntry(projectDir, linkTargetPath(dest, symlinkTo));
  return { disk, diskSha, lockSha, targetEntry };
}
