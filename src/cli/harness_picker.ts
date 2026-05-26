import { HARNESSES } from "./harnesses.ts";
import { selectInteractive, type SelectIO } from "./select.ts";

export type HarnessKey =
  | "claude"
  | "cursor"
  | "codex"
  | "windsurf"
  | "copilot"
  | "opencode"
  | "antigravity";

export const DEFAULT_HARNESS: HarnessKey = "claude";

export type PickerIO = {
  readLine: () => string | null;
  log: (s: string) => void;
  errLog: (s: string) => void;
};

export function pickHarness(io: PickerIO): HarnessKey {
  io.log("Choose your AI harness (press Enter for default):");
  for (let i = 0; i < HARNESSES.length; i++) {
    const h = HARNESSES[i];
    const marker = h.key === DEFAULT_HARNESS ? " (default)" : "";
    io.log(`  ${i + 1}) ${h.displayName}${marker}`);
  }
  while (true) {
    const raw = (io.readLine() ?? "").trim();
    if (raw === "") return DEFAULT_HARNESS;
    const idx = parseInt(raw, 10) - 1;
    if (Number.isInteger(idx) && idx >= 0 && idx < HARNESSES.length) {
      return HARNESSES[idx].key as HarnessKey;
    }
    io.errLog(
      `invalid choice "${raw}" — expected 1-${HARNESSES.length} or empty for default`,
    );
  }
}

export async function pickHarnessInteractive(
  io: SelectIO,
): Promise<HarnessKey | null> {
  const defaultIdx = HARNESSES.findIndex((h) => h.key === DEFAULT_HARNESS);
  const items = HARNESSES.map((h) => ({
    key: h.key as HarnessKey,
    label: h.key === DEFAULT_HARNESS ? `${h.displayName} (default)` : h.displayName,
  }));
  return await selectInteractive(
    items,
    defaultIdx >= 0 ? defaultIdx : 0,
    io,
    "Choose your AI harness (↑/↓ to move, space/enter to select, Ctrl-C to cancel):",
  );
}
