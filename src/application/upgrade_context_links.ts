import type { FsReader } from "./ports.ts";
import type { Bundle } from "../domain/template.ts";
import type { InstalledLock } from "../domain/installed_lock.ts";
import { sha256Hex } from "../domain/sha256.ts";
import { classifyLinkDisk, linkIdentity, linkTargetPath } from "../domain/context_link.ts";
import type { PlannableLinkState } from "../domain/link_plan.ts";

/** What `upgrade` learned about the context-link destinations of a bundle. */
export type ContextLinkSurvey = {
  /** The disk state of each destination the plan may act on. */
  readonly states: Map<string, PlannableLinkState>;
  /** A sha per destination present on disk, for the plan's presence checks. */
  readonly diskShas: Map<string, string>;
  /**
   * Destinations refused outright, each with the sentence that says why: the
   * target links back to them, so they hold the user's only copy.
   */
  readonly refused: ReadonlyArray<{ readonly dest: string; readonly message: string }>;
  /** One note per link a `core.symlinks=false` checkout had turned into text. */
  readonly notes: ReadonlyArray<string>;
};

/**
 * Classify every context-link destination in `bundle` (cli#680, cli#681).
 *
 * Read with `readEntry`, never `readText`: through the link `readText` reads
 * `AGENTS.md`, and through a foreign link pointing out of the project it
 * throws — which would abort the very upgrade that replaces the link.
 */
export async function surveyContextLinks(
  reader: FsReader,
  projectDir: string,
  bundle: Bundle,
  lock: InstalledLock,
  isDeclaredPreserved: (dest: string) => boolean,
): Promise<ContextLinkSurvey> {
  const states = new Map<string, PlannableLinkState>();
  const diskShas = new Map<string, string>();
  const refused: Array<{ dest: string; message: string }> = [];
  const notes: string[] = [];
  for (const [dest, file] of Object.entries(bundle)) {
    // A declaration wins over everything (spec 011): the plan preserves it
    // before it ever asks what is on disk.
    if (file.symlinkTo === undefined || isDeclaredPreserved(dest)) continue;
    const targetPath = linkTargetPath(dest, file.symlinkTo);
    const disk = await reader.readEntry(projectDir, dest);
    const diskSha = disk === null ? undefined : await sha256Hex(
      disk.kind === "file" ? disk.content : linkIdentity(disk.target),
    );
    const state = classifyLinkDisk(dest, { symlinkTo: file.symlinkTo, content: file.content }, {
      disk,
      diskSha,
      lockSha: lock.entries.get(dest)?.sha256,
      targetEntry: await reader.readEntry(projectDir, targetPath),
    });
    if (state === "inverted") {
      refused.push({ dest, message: invertedMessage(dest, targetPath) });
      continue;
    }
    if (state === "materialised") notes.push(materialisedNote(dest, file.symlinkTo));
    states.set(dest, state);
    if (diskSha !== undefined) diskShas.set(dest, diskSha);
  }
  return { states, diskShas, refused, notes };
}

const invertedMessage = (dest: string, target: string) =>
  `${target} links to ${dest}, so your instructions live in ${dest} — left untouched. ` +
  `Specnaut keeps them in ${target} and links ${dest} to it. To adopt that, replace the ` +
  `${target} link with the content of ${dest}, then run \`specnaut upgrade\` again.`;

/**
 * Said, not just done: rewriting the materialised file makes a git type change,
 * and committed it switches the repository's form for everyone. Both forms
 * load the same file, so it is reported rather than refused.
 */
const materialisedNote = (dest: string, target: string) =>
  `${dest} held the text "${target}" — a link that git checked out as a plain file ` +
  `(core.symlinks=false). It is a context link again, so git may show a type change ` +
  `there; either form works if you commit it.`;
