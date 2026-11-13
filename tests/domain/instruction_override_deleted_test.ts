import { assertEquals } from "@std/assert";
import type { ConfigFile } from "../../src/domain/config_trust.ts";
import { COMMITTED_INSTRUCTIONS, judgeInstructions } from "../../src/domain/instruction_trust.ts";
import { type BaseEntry, REASON } from "../../src/domain/script_trust.ts";

/**
 * A committed override (`AGENTS.override.md`, `CLAUDE.local.md`, `.claude/settings.local.json`)
 * that the base's tip holds and HEAD does not: the branch deleted what a session loads, which is
 * a change like any other. Silence is kept for a copy neither side commits.
 */

const file = (s: string): ConfigFile => ({ kind: "file", bytes: new TextEncoder().encode(s) });
const none: ConfigFile = { kind: "absent" };

function judge(path: (typeof COMMITTED_INSTRUCTIONS)[number], tip: ConfigFile, mergeBase = tip) {
  const head: BaseEntry[] = [];
  const input = { tree: [], tip: [], mergeBase: [], head, symlinks: true };
  return judgeInstructions({ ...input, committed: [{ path, tip, mergeBase }] })
    .map((v) => v.trusted ? "trusted" : `${v.path} ${v.reason}`);
}

Deno.test("an override the tip commits and HEAD deletes is missing", () => {
  for (const path of COMMITTED_INSTRUCTIONS) {
    assertEquals(judge(path, file("x")), [`${path} ${REASON.missing}`]);
  }
});

Deno.test("an override the base committed after the branch left it is behind", () => {
  for (const path of COMMITTED_INSTRUCTIONS) {
    assertEquals(judge(path, file("x"), none), [`${path} ${REASON.behind}`]);
  }
});

Deno.test("an override neither side commits stays silent", () => {
  for (const path of COMMITTED_INSTRUCTIONS) assertEquals(judge(path, none), ["trusted"]);
});
