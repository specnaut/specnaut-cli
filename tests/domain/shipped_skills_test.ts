import { assertEquals } from "@std/assert";
import { sha256Hex } from "../../src/domain/sha256.ts";
import type { BaseEntry } from "../../src/domain/script_trust.ts";
import {
  isSkillPath,
  leavingCopies,
  LOCK_SKILL_REASON,
  lockSkillReasons,
  SHIPPED_REASON,
  type ShippedCopy,
  shippedLookup,
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

Deno.test("an approved digest holds where the bundle differs, and only for those exact bytes", async () => {
  const approvedSha256 = await sha256Hex("mine");
  const copy: ShippedCopy = { bytes: enc("ship"), approvedSha256 };
  assertEquals(await judge([blob(SKILL, "mine")], [[SKILL, copy]]), []);
  assertEquals(await judge([blob(SKILL, "mine.")], [[SKILL, copy]]), [
    `${SKILL} ${SHIPPED_REASON}`,
  ]);
});

Deno.test("an approval never holds a link where Specnaut ships a file", async () => {
  const link: BaseEntry = { kind: "link", path: SKILL, target: "mine" };
  const copy: ShippedCopy = { bytes: enc("ship"), approvedSha256: await sha256Hex("mine") };
  assertEquals(await judge([link], [[SKILL, copy]]), [`${SKILL} ${SHIPPED_REASON}`]);
});

// A case-blind disk gives a session one file for both names: the twin is the shipped skill.
const TWIN = ".claude/skills/Task/SKILL.md";

Deno.test("a skill in another letter case than a shipped one is judged against its copy", async () => {
  const ship: [string, ShippedCopy][] = [[SKILL, { bytes: enc("ship") }]];
  assertEquals(await judge([blob(SKILL, "ship"), blob(TWIN, "edited")], ship), [
    `${TWIN} ${SHIPPED_REASON}`,
  ]);
  assertEquals(await judge([blob(TWIN, "ship")], ship), [], "a rename holding the shipped bytes");
});

Deno.test("a copy found only in another letter case carries no approval", async () => {
  const copy: ShippedCopy = { bytes: enc("ship"), approvedSha256: await sha256Hex("mine") };
  assertEquals(await judge([blob(TWIN, "mine")], [[SKILL, copy]]), [`${TWIN} ${SHIPPED_REASON}`]);
  const copyAt = shippedLookup(new Map([[SKILL, copy]]));
  assertEquals([copyAt(SKILL), copyAt(TWIN)], [copy, { bytes: enc("ship") }]);
});

const entry = (sha256: string) => ({ sha256, installedAt: "", templatesVersion: "" });
const LOCK = ".specnaut/installed.lock";

Deno.test("a branch's lock that records a skill digest Specnaut does not ship is named", () => {
  const head = new Map([[SKILL, entry("b".repeat(64))]]);
  const old = new Map([[SKILL, entry("a".repeat(64))]]);
  const bundled = new Map([[SKILL, "c".repeat(64)]]);
  assertEquals(lockSkillReasons(head, old, bundled), [{ path: LOCK, reason: LOCK_SKILL_REASON }]);
  assertEquals(lockSkillReasons(head, undefined, bundled).length, 1, "a first lock too");
});

Deno.test("a lock left as the merge base had it, or set to the bundle's digest, is silent", () => {
  const sha = "b".repeat(64);
  const head = new Map([[SKILL, entry(sha)], [".claude/agents/x.md", entry("d".repeat(64))]]);
  assertEquals(lockSkillReasons(head, new Map([[SKILL, entry(sha)]]), new Map()), []);
  assertEquals(lockSkillReasons(head, undefined, new Map([[SKILL, sha]])), []);
});

Deno.test("a skill path the merge base ships and HEAD's lock does not is judged, unapproved", () => {
  const mine: ShippedCopy = { bytes: enc("ship"), approvedSha256: "a".repeat(64) };
  const old: ShippedCopy = { sha256: "b".repeat(64) };
  const gone = ".claude/skills/retired/SKILL.md";
  const kept = ".claude/skills/kept/SKILL.md";
  const tip = new Map([[SKILL, mine], [kept, mine]]);
  const out = leavingCopies(tip, new Map([[SKILL, {}], [gone, old], [kept, {}]]), new Set([kept]));
  assertEquals(out, new Map([[SKILL, { bytes: enc("ship") }], [kept, mine], [gone, old]]));
  assertEquals(leavingCopies(tip, new Map(), new Set()), tip, "no lock at the merge base");
});
