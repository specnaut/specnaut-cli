import { type SpecBackend } from "../domain/installed_lock.ts";
import { SPEC_STRATEGIES } from "../domain/spec_strategies/registry.ts";
import { selectInteractive, type SelectIO } from "./select.ts";

export const DEFAULT_SPEC_BACKEND: SpecBackend = "cloud";

/** Suffix on the default backend's line — signals it's the recommended pick. */
const RECOMMENDED_MARKER = " — recommended (default)";

/**
 * One-line "why this is the recommended default" note, shown once above the
 * choices for whichever backend is the default. Keyed by backend so it stays
 * correct if the default ever moves.
 */
const DEFAULT_BACKEND_NOTE: Partial<Record<SpecBackend, string>> = {
  cloud: "SpecNaut Cloud: hosted specs — parallelisable (no branch per spec), shareable.",
};

export type SpecPickerIO = {
  readLine: () => string | null;
  log: (s: string) => void;
  errLog: (s: string) => void;
};

/**
 * Non-interactive picker (numeric prompt / CI). Enter → the recommended default
 * (`cloud`); a valid number → that backend; anything else re-prompts.
 * Mirrors {@link pickBacklogBackend}.
 */
export function pickSpecBackend(io: SpecPickerIO): SpecBackend {
  io.log("Choose where your specifications are stored (press Enter for default):");
  for (let i = 0; i < SPEC_STRATEGIES.length; i++) {
    const s = SPEC_STRATEGIES[i];
    const marker = s.key === DEFAULT_SPEC_BACKEND ? RECOMMENDED_MARKER : "";
    io.log(`  ${i + 1}) ${s.displayName}${marker}`);
  }
  const note = DEFAULT_BACKEND_NOTE[DEFAULT_SPEC_BACKEND];
  if (note) io.log(`  ↳ ${note}`);
  while (true) {
    const raw = (io.readLine() ?? "").trim();
    if (raw === "") return DEFAULT_SPEC_BACKEND;
    const idx = parseInt(raw, 10) - 1;
    if (
      Number.isInteger(idx) &&
      idx >= 0 &&
      idx < SPEC_STRATEGIES.length
    ) {
      return SPEC_STRATEGIES[idx].key;
    }
    io.errLog(
      `invalid choice "${raw}" — expected 1-${SPEC_STRATEGIES.length} or empty for default`,
    );
  }
}

/**
 * Interactive arrow-key picker (TTY). Returns the chosen backend, or `null`
 * when the user cancels (Ctrl-C). Mirrors {@link pickBacklogBackendInteractive}.
 */
export async function pickSpecBackendInteractive(
  io: SelectIO,
): Promise<SpecBackend | null> {
  const defaultIdx = SPEC_STRATEGIES.findIndex(
    (s) => s.key === DEFAULT_SPEC_BACKEND,
  );
  const items = SPEC_STRATEGIES.map((s) => ({
    key: s.key,
    label: s.key === DEFAULT_SPEC_BACKEND ? `${s.displayName}${RECOMMENDED_MARKER}` : s.displayName,
  }));
  // Printed once above the menu; the picker's redraw only rewinds over the
  // menu frame, so this benefit line stays put.
  const note = DEFAULT_BACKEND_NOTE[DEFAULT_SPEC_BACKEND];
  if (note) io.write(`  ↳ ${note}\n`);
  return await selectInteractive(
    items,
    defaultIdx >= 0 ? defaultIdx : 0,
    io,
    "Choose where your specs are stored (↑/↓ to move, space/enter to select, Ctrl-C to cancel):",
  );
}
