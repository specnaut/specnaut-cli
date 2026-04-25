import type { Harness } from "../application/ports.ts";
import { ClaudeHarness } from "../infrastructure/harness/claude_harness.ts";
import { CursorHarness } from "../infrastructure/harness/cursor_harness.ts";
import { CodexHarness } from "../infrastructure/harness/codex_harness.ts";
import { GeminiHarness } from "../infrastructure/harness/gemini_harness.ts";
import { WindsurfHarness } from "../infrastructure/harness/windsurf_harness.ts";

export const HARNESSES: ReadonlyArray<Harness> = [
  new ClaudeHarness(),
  new CursorHarness(),
  new CodexHarness(),
  new GeminiHarness(),
  new WindsurfHarness(),
];

export function findHarness(key: string): Harness | null {
  return HARNESSES.find((h) => h.key === key) ?? null;
}
