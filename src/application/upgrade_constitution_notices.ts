import type { FsReader } from "./ports.ts";
import type { ConstitutionMove } from "../domain/constitution_move.ts";
import { CONSTITUTION_PATH, SIZE_LIMITS_CONFIG_PATH } from "../domain/constitution_paths.ts";
import { missingPrinciples } from "../domain/constitution_principles.ts";
import {
  constitutionCeilingNote,
  constitutionOverCeiling,
  sizeConfigFromEntry,
  sizeConfigUnreadableNote,
} from "../domain/size_limits.ts";

/**
 * The constitution the project will have once the run is done: the moved
 * bytes on a move (on a dry run they are not there yet), otherwise what is at
 * `docs/constitution.md`. `null` means the bootstrap is about to be written,
 * or — on a `refuse-unreadable` verdict — that there is no text to judge: the
 * refusal already says why, and a second read of a file that cannot be read
 * must not turn the refusal into an abort.
 */
export async function constitutionAfterRun(
  reader: FsReader,
  projectDir: string,
  move: ConstitutionMove,
): Promise<string | null> {
  if (move.kind === "move") return move.content;
  if (move.kind === "refuse-unreadable") return null;
  return await reader.readText(projectDir, CONSTITUTION_PATH);
}

/**
 * What upgrade says about the project's constitution, which it never edits
 * (spec 038): the default principles it lacks (US3), and a size over its
 * ceiling (FR-016). This is how a team learns either — said once per run,
 * beside the move's own notes.
 *
 * Judged against `constitutionAfterRun`. Nothing there means the bootstrap is
 * about to be written, which carries every principle and fits its ceiling. The
 * ceiling is the config's `constitution` unit; a config the ratchet would stop
 * on is said instead, never judged against the defaults (A-L4).
 */
export async function constitutionNotices(
  reader: FsReader,
  projectDir: string,
  bootstrap: string | undefined,
  move: ConstitutionMove,
): Promise<string[]> {
  const text = await constitutionAfterRun(reader, projectDir, move);
  if (text === null) return [];
  const notices: string[] = [];
  const missing = bootstrap === undefined ? [] : missingPrinciples(bootstrap, text);
  if (missing.length > 0) {
    notices.push(
      `${CONSTITUTION_PATH} lacks the default principles ${missing.join(", ")} — ` +
        `add any that apply; upgrade never edits the file`,
    );
  }
  const config = sizeConfigFromEntry(await reader.readEntry(projectDir, SIZE_LIMITS_CONFIG_PATH));
  if (config.kind === "unreadable") return [...notices, sizeConfigUnreadableNote(config.reason)];
  const over = constitutionOverCeiling(text, config.limits.units.constitution);
  if (over !== null) notices.push(constitutionCeilingNote(over));
  return notices;
}
