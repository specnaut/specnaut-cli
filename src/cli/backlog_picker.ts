import { type BacklogBackend } from "../domain/installed_lock.ts";
import { BACKLOG_STRATEGIES } from "../domain/backlog_strategies/registry.ts";

export const DEFAULT_BACKLOG_BACKEND: BacklogBackend = "local";

export type BacklogPickerIO = {
  readLine: () => string | null;
  log: (s: string) => void;
  errLog: (s: string) => void;
};

export function pickBacklogBackend(io: BacklogPickerIO): BacklogBackend {
  io.log("Choose your backlog backend (press Enter for default):");
  for (let i = 0; i < BACKLOG_STRATEGIES.length; i++) {
    const s = BACKLOG_STRATEGIES[i];
    const marker = s.key === DEFAULT_BACKLOG_BACKEND ? " (default)" : "";
    io.log(`  ${i + 1}) ${s.displayName}${marker}`);
  }
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
