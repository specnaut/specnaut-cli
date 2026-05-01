import type { Harness } from "../application/ports.ts";
import { ClaudeHarness } from "../infrastructure/harness/claude_harness.ts";
import { CursorHarness } from "../infrastructure/harness/cursor_harness.ts";
import { CodexHarness } from "../infrastructure/harness/codex_harness.ts";
import { GeminiHarness } from "../infrastructure/harness/gemini_harness.ts";
import { WindsurfHarness } from "../infrastructure/harness/windsurf_harness.ts";
import { CopilotHarness } from "../infrastructure/harness/copilot_harness.ts";
import { OpenCodeHarness } from "../infrastructure/harness/opencode_harness.ts";
import { AntigravityHarness } from "../infrastructure/harness/antigravity_harness.ts";

export const HARNESSES: ReadonlyArray<Harness> = [
  new ClaudeHarness(),
  new CursorHarness(),
  new CodexHarness(),
  new GeminiHarness(),
  new WindsurfHarness(),
  new CopilotHarness(),
  new OpenCodeHarness(),
  new AntigravityHarness(),
];

export function findHarness(key: string): Harness | null {
  return HARNESSES.find((h) => h.key === key) ?? null;
}
