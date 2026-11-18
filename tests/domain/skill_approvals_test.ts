import { assertEquals, assertThrows } from "@std/assert";
import {
  APPROVALS_FILE,
  isApprovalKey,
  nextApprovals,
  parseApprovals,
  renderApprovals,
} from "../../src/domain/skill_approvals.ts";

/**
 * The approvals file binds a customised copy of a shipped skill to its SHA-256. It is read strictly:
 * a file that is not exactly the form `renderApprovals` writes approves nothing.
 */

const enc = (s: string) => new TextEncoder().encode(s);
const A = "a".repeat(64);
const B = "b".repeat(64);
const TASK = ".claude/skills/task/SKILL.md";
const SHIP = ".claude/skills/ship/SKILL.md";

Deno.test("the file lives with the project's own files under .specnaut/", () => {
  assertEquals(APPROVALS_FILE, ".specnaut/approved-skills.txt");
});

Deno.test("what renderApprovals writes reads back as the same approvals, sorted by path", () => {
  const text = renderApprovals(new Map([[TASK, A], [SHIP, B]]));
  assertEquals(text, `${B}  ${SHIP}\n${A}  ${TASK}\n`);
  assertEquals([...parseApprovals(enc(text))], [[SHIP, B], [TASK, A]]);
  assertEquals(renderApprovals(new Map()), "");
  assertEquals(parseApprovals(enc("")).size, 0);
});

Deno.test("any line not in the written form refuses the whole file", () => {
  const bad = [
    `${A}  ${TASK}`, // no final LF
    `${A}  ${TASK}\r\n`,
    `${A} ${TASK}\n`, // one space
    `${A.toUpperCase()}  ${TASK}\n`,
    `${A.slice(1)}  ${TASK}\n`,
    `${A}  ${TASK}\n\n`,
    `${A}  ${TASK}\n${B}  ${SHIP}\n`, // unsorted
    `${A}  ${TASK}\n${B}  ${TASK}\n`, // a path twice
    "version https://git-lfs.github.com/spec/v1\noid sha256:" + A + "\nsize 12\n",
  ];
  for (const text of bad) assertThrows(() => parseApprovals(enc(text)), Error, undefined, text);
  assertThrows(() => parseApprovals(new Uint8Array([0xff, 0x0a])), Error);
});

Deno.test("a key is a shipped skill folder's path as git lists it, and nothing else", () => {
  const refused = [
    "/.claude/skills/task/SKILL.md",
    "./.claude/skills/task/SKILL.md",
    ".claude/skills/../agents/x.md",
    ".claude/skills/./task/SKILL.md",
    ".claude/skills//task/SKILL.md",
    ".claude/skills\\task\\SKILL.md",
    ".claude/skills/task/SKILL.md\t",
    ".claude/skills/task/",
    ".claude/agents/developer.md",
    "AGENTS.md",
  ];
  assertEquals(refused.filter(isApprovalKey), []);
  assertEquals([TASK, ".agents/skills/specnaut-task/SKILL.md"].every(isApprovalKey), true);
  for (const key of refused) {
    assertThrows(() => parseApprovals(enc(`${A}  ${key}\n`)), Error, undefined, key);
  }
});

Deno.test("a write keeps an approval only while HEAD holds those bytes, still customised", () => {
  const previous = new Map([[TASK, A], [SHIP, B], [".claude/skills/gone/SKILL.md", A]]);
  const head = new Map([
    [TASK, { sha256: A, customised: true }],
    [SHIP, { sha256: B, customised: false }], // now the shipped copy: dropped
  ]);
  assertEquals([...nextApprovals(previous, head, new Map())], [[TASK, A]]);
  const moved = new Map([[TASK, { sha256: B, customised: true }]]);
  assertEquals([...nextApprovals(previous, moved, new Map())], []);
  assertEquals([...nextApprovals(previous, moved, new Map([[TASK, B]]))], [[TASK, B]]);
});
