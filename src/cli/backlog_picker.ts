import { type BacklogBackend, KNOWN_BACKLOG_BACKENDS } from "../domain/installed_lock.ts";

export const DEFAULT_BACKLOG_BACKEND: BacklogBackend = "local";

const DISPLAY_NAMES: Record<BacklogBackend, string> = {
  local: "Local Markdown files (.specflow/backlog/)",
  github: "GitHub Issues + Project (requires gh CLI)",
  gitlab: "GitLab Issues + scoped Status labels (requires glab CLI)",
};

export type BacklogPickerIO = {
  readLine: () => string | null;
  log: (s: string) => void;
  errLog: (s: string) => void;
};

export function pickBacklogBackend(io: BacklogPickerIO): BacklogBackend {
  io.log("Choose your backlog backend (press Enter for default):");
  for (let i = 0; i < KNOWN_BACKLOG_BACKENDS.length; i++) {
    const k = KNOWN_BACKLOG_BACKENDS[i];
    const marker = k === DEFAULT_BACKLOG_BACKEND ? " (default)" : "";
    io.log(`  ${i + 1}) ${DISPLAY_NAMES[k]}${marker}`);
  }
  while (true) {
    const raw = (io.readLine() ?? "").trim();
    if (raw === "") return DEFAULT_BACKLOG_BACKEND;
    const idx = parseInt(raw, 10) - 1;
    if (
      Number.isInteger(idx) && idx >= 0 && idx < KNOWN_BACKLOG_BACKENDS.length
    ) {
      return KNOWN_BACKLOG_BACKENDS[idx];
    }
    io.errLog(
      `invalid choice "${raw}" — expected 1-${KNOWN_BACKLOG_BACKENDS.length} or empty for default`,
    );
  }
}
