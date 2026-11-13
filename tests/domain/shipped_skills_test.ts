import { assertEquals } from "@std/assert";
import { sha256Hex } from "../../src/domain/sha256.ts";
import type { BaseEntry } from "../../src/domain/script_trust.ts";
import {
  isSkillPath,
  SHIPPED_REASON,
  type ShippedCopy,
  shippedReasons,
} from "../../src/domain/shipped_skills.ts";

/**
 * A skill Specnaut ships is judged against the copy it ships, whatever the base holds: a base that
 * already carries an edited copy would otherwise vouch for it.
 */

const enc = (s: string) => new TextEncoder().encode(s);
const SKILL = ".claude/skills/task/SKILL.md";
const blob = (path: string, text: string): BaseEntry => ({ kind: "blob", path, bytes: enc(text) });
const judge = (head: BaseEntry[], shipped: [string, ShippedCopy][]) =>
  shippedReasons(head, new Map(shipped)).then((r) => r.map((u) => `${u.path} ${u.reason}`));

Deno.test("a shipped skill holding the bundled bytes is not named", async () => {
  assertEquals(await judge([blob(SKILL, "ship")], [[SKILL, { bytes: enc("ship") }]]), []);
});

Deno.test("a shipped skill holding other bytes is named, whatever the base holds", async () => {
  assertEquals(await judge([blob(SKILL, "edited")], [[SKILL, { bytes: enc("ship") }]]), [
    `${SKILL} ${SHIPPED_REASON}`,
  ]);
});

Deno.test("the bytes the lock records as installed hold too: the binary may be newer", async () => {
  const sha256 = await sha256Hex("installed");
  const copy: ShippedCopy = { bytes: enc("newer"), sha256 };
  assertEquals(await judge([blob(SKILL, "installed")], [[SKILL, copy]]), []);
  assertEquals(await judge([blob(SKILL, "edited")], [[SKILL, { sha256 }]]), [
    `${SKILL} ${SHIPPED_REASON}`,
  ]);
});

Deno.test("a skill Specnaut does not ship is left to the base comparison", async () => {
  assertEquals(await judge([blob(".claude/skills/mine/SKILL.md", "x")], []), []);
});

Deno.test("a link where Specnaut ships a file is named", async () => {
  const link: BaseEntry = { kind: "link", path: SKILL, target: "../../notes.md" };
  assertEquals(await judge([link], [[SKILL, { bytes: enc("ship") }]]), [
    `${SKILL} ${SHIPPED_REASON}`,
  ]);
});

Deno.test("the skill folders are the ones Specnaut writes for Claude Code and Codex", () => {
  assertEquals(
    [SKILL, ".agents/skills/specnaut-task/SKILL.md", ".claude/agents/developer.md"].map(
      isSkillPath,
    ),
    [true, true, false],
  );
});
