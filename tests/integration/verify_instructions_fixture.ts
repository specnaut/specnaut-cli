import { assertEquals } from "@std/assert";
import { INSTRUCTION_REASON } from "../../src/domain/instruction_trust.ts";
import { bundled, GIT_READ, LOCK, verify } from "./verify_scripts_fixture.ts";

// Shared by the instruction verdict's black-box tests: a base holding the instruction files, and
// the `VERDICT instructions` lines of a run, checked to sit after every config line.

export const NOT_HEAD = INSTRUCTION_REASON.notHead;
export const INSTRUCTIONS: Record<string, string> = {
  "AGENTS.md": "# Rules\n\nRun every gate.\n",
  "docs/constitution.md": "# Constitution\n",
  ".specnaut/addenda/task/merge.md": "Ask before landing.\n",
};

export const base = () => ({
  ".specnaut/installed.lock": LOCK,
  [GIT_READ]: bundled(GIT_READ),
  ...INSTRUCTIONS,
});
export const lines = async (root: string) => {
  const v = await verify(root);
  assertEquals([v.code, v.lines.at(-1)], [0, "VERDICT scripts trusted"], v.stderr);
  const at = v.lines.findIndex((l) => l.startsWith("VERDICT instructions "));
  // After every config line: the instruction verdict is the last class before the scripts'.
  assertEquals(
    v.lines.slice(at).every((l) => !/^VERDICT (?!instructions |scripts )/.test(l)),
    true,
  );
  return v.lines.filter((l) => l.startsWith("VERDICT instructions "));
};
