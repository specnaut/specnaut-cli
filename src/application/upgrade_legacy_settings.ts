import type { FsReader, FsWriter } from "./ports.ts";
import {
  CONSTITUTION_PATH,
  SIZE_LIMITS_CONFIG_PATH,
  UI_CONFIG_PATH,
} from "../domain/constitution_paths.ts";
import {
  extractLegacySizeLimits,
  extractLegacyTargetSurface,
  type LegacySetting,
} from "../domain/constitution_legacy_settings.ts";

/** What the carry needs: the two existing ports, no new one. */
export type LegacySettingsIo = {
  readonly reader: FsReader;
  readonly writer: FsWriter;
  readonly projectDir: string;
  readonly dryRun: boolean;
};

/** Each setting a constitution used to carry, where it lives now, and who reads it there. */
const SETTINGS: ReadonlyArray<{
  readonly what: string;
  readonly to: string;
  readonly readBy: string;
  readonly extract: (constitution: string) => LegacySetting;
}> = [
  {
    what: "its size-limits table",
    to: SIZE_LIMITS_CONFIG_PATH,
    readBy: "the size ratchet",
    extract: extractLegacySizeLimits,
  },
  {
    what: "its target-surface declaration",
    to: UI_CONFIG_PATH,
    readBy: "the mobile-first contract",
    extract: extractLegacyTargetSurface,
  },
];

/**
 * Carries a pre-038 constitution's size table and target-surface declaration
 * into their configs (FR-010), so a project that customised either keeps it.
 *
 * The constitution is never edited: the note says its stale section is no
 * longer read and may be deleted. A config already there — a file, a link,
 * anything `lstat` sees — is the project's and is left alone, so this writes
 * at most once. The write goes through the writer with `overwrite: false` and
 * `skipIfExists`, so a link planted between the check and the write is not
 * followed out of the project (S5). Under `dryRun` it says what it would do.
 *
 * `constitution` is the text the run ends with (see `constitutionAfterRun`).
 */
export async function carryLegacySettings(
  io: LegacySettingsIo,
  constitution: string | null,
): Promise<string[]> {
  if (constitution === null) return [];
  const notes: string[] = [];
  for (const s of SETTINGS) {
    const found = s.extract(constitution);
    if (found.kind === "none") continue;
    if (await io.reader.readEntry(io.projectDir, s.to) !== null) continue;
    notes.push(await carryOne(io, s, found));
  }
  return notes;
}

/** One setting found in the constitution, for a config that is not there yet: the note. */
async function carryOne(
  io: LegacySettingsIo,
  s: typeof SETTINGS[number],
  found: Exclude<LegacySetting, { kind: "none" }>,
): Promise<string> {
  if (found.kind === "refuse") {
    return `${CONSTITUTION_PATH}: ${s.what} is not carried to ${s.to}: ${found.reason} — ` +
      `${s.readBy} no longer reads the constitution; write ${s.to} yourself`;
  }
  const from = `from ${s.what} in ${CONSTITUTION_PATH}`;
  const notCarried = `not carried: ${found.dropped.join(", ")}`;
  const dropped = found.dropped.length === 0
    ? ""
    : ` (${notCarried} — the config sets file, function and constitution)`;
  if (io.dryRun) return `would write ${s.to} ${from}${dropped}`;
  const now = `${s.readBy} reads it now; that section is no longer read and can be deleted`;
  return await write(io, s.to, found.content, `${from}${dropped} — ${now}`);
}

/** One config, written only if absent; the outcome said either way. */
async function write(io: LegacySettingsIo, to: string, content: string, why: string) {
  try {
    const r = await io.writer.writeBundle(
      { [to]: { content, executable: false, skipIfExists: true } },
      io.projectDir,
      { overwrite: false },
    );
    if (r.skippedSkipIfExists.includes(to)) {
      return `${to} is not written: something is already there`;
    }
    return `wrote ${to} ${why}`;
  } catch (err) {
    return `${to} is not written: ${err instanceof Error ? err.message : String(err)}`;
  }
}
