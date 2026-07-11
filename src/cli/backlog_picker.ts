import { type BacklogBackend } from "../domain/installed_lock.ts";
import { BACKLOG_STRATEGIES } from "../domain/backlog_strategies/registry.ts";
import {
  type ParsedKanbanURL,
  parseKanbanURL,
} from "../domain/backlog_strategies/kanban_url_parser.ts";
import { selectInteractive, type SelectIO } from "./select.ts";

export const DEFAULT_BACKLOG_BACKEND: BacklogBackend = "cloud";

/** Suffix on the default backend's line — signals it's the recommended pick. */
const RECOMMENDED_MARKER = " — recommended (default)";

/**
 * One-line "why this is the recommended default" note, shown once above the
 * choices for whichever backend is the default. Keyed by backend so it stays
 * correct if the default ever moves.
 */
const DEFAULT_BACKEND_NOTE: Partial<Record<BacklogBackend, string>> = {
  cloud: "Specnaut Cloud: hosted online Kanban — shareable, real-time, no local file upkeep.",
};

export type BacklogPickerIO = {
  readLine: () => string | null;
  log: (s: string) => void;
  errLog: (s: string) => void;
};

export function pickBacklogBackend(io: BacklogPickerIO): BacklogBackend {
  io.log("Choose your backlog backend (press Enter for default):");
  for (let i = 0; i < BACKLOG_STRATEGIES.length; i++) {
    const s = BACKLOG_STRATEGIES[i];
    const marker = s.key === DEFAULT_BACKLOG_BACKEND ? RECOMMENDED_MARKER : "";
    io.log(`  ${i + 1}) ${s.displayName}${marker}`);
  }
  const note = DEFAULT_BACKEND_NOTE[DEFAULT_BACKLOG_BACKEND];
  if (note) io.log(`  ↳ ${note}`);
  while (true) {
    const raw = (io.readLine() ?? "").trim();
    if (raw === "") return DEFAULT_BACKLOG_BACKEND;
    const idx = parseInt(raw, 10) - 1;
    if (
      Number.isInteger(idx) &&
      idx >= 0 &&
      idx < BACKLOG_STRATEGIES.length
    ) {
      return BACKLOG_STRATEGIES[idx].key;
    }
    io.errLog(
      `invalid choice "${raw}" — expected 1-${BACKLOG_STRATEGIES.length} or empty for default`,
    );
  }
}

export async function pickBacklogBackendInteractive(
  io: SelectIO,
): Promise<BacklogBackend | null> {
  const defaultIdx = BACKLOG_STRATEGIES.findIndex(
    (s) => s.key === DEFAULT_BACKLOG_BACKEND,
  );
  const items = BACKLOG_STRATEGIES.map((s) => ({
    key: s.key,
    label: s.key === DEFAULT_BACKLOG_BACKEND
      ? `${s.displayName}${RECOMMENDED_MARKER}`
      : s.displayName,
  }));
  // Printed once above the menu; the picker's redraw only rewinds over the
  // menu frame, so this benefit line stays put.
  const note = DEFAULT_BACKEND_NOTE[DEFAULT_BACKLOG_BACKEND];
  if (note) io.write(`  ↳ ${note}\n`);
  return await selectInteractive(
    items,
    defaultIdx >= 0 ? defaultIdx : 0,
    io,
    "Choose your backlog backend (↑/↓ to move, space/enter to select, Ctrl-C to cancel):",
  );
}

const URL_PROMPT_RETRIES = 3;

/**
 * Prompts for a Kanban / project URL when the user picked a remote
 * backlog backend (`github` or `gitlab`). Loops on malformed input up
 * to `URL_PROMPT_RETRIES` times, then returns `null` so the caller
 * can decide whether to fall through (empty stub) or abort.
 *
 * Pure I/O via the `BacklogPickerIO` interface — testable with a
 * fakeIO that scripts a sequence of `readLine` returns.
 */
export function promptKanbanURL(
  backend: "github" | "gitlab",
  io: BacklogPickerIO,
): ParsedKanbanURL | null {
  const example = backend === "github"
    ? "https://github.com/orgs/<org>/projects/<N>  (or /users/<user>/projects/<N>)"
    : "https://gitlab.com/<group>/<project>  (or your self-hosted host)";
  io.log(`Paste your ${backend} project URL (Enter to skip and fill in by hand):`);
  io.log(`  example: ${example}`);

  for (let attempt = 0; attempt < URL_PROMPT_RETRIES; attempt++) {
    const raw = (io.readLine() ?? "").trim();
    if (raw === "") return null; // user explicitly skipped
    const parsed = parseKanbanURL(raw);
    if (parsed === null) {
      io.errLog(
        `couldn't parse "${raw}" — expected ${example}`,
      );
      continue;
    }
    if (parsed.kind !== backend) {
      io.errLog(
        `URL looks like a ${parsed.kind} URL, but you picked ${backend} — re-enter the right URL or press Enter to skip`,
      );
      continue;
    }
    return parsed;
  }
  io.errLog(`giving up after ${URL_PROMPT_RETRIES} tries — falling back to empty stub`);
  return null;
}
