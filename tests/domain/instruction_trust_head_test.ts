import { assertEquals } from "@std/assert";
import type { CheckoutEntry, CheckoutWalk } from "../../src/domain/checkout_trust.ts";
import type { ConfigFile } from "../../src/domain/config_trust.ts";
import {
  COMMITTED_INSTRUCTIONS,
  type CommittedInstruction,
  INSTRUCTION_REASON,
  type InstructionInput,
  judgeInstructions,
} from "../../src/domain/instruction_trust.ts";
import { type BaseEntry, REASON } from "../../src/domain/script_trust.ts";

/**
 * What lands is HEAD's commit, so the instruction class is judged there as well as in the work
 * tree: a work tree that does not hold HEAD's entry is untrusted, whatever it holds against the
 * tip, and the overrides are read from HEAD alone.
 */

const enc = (s: string) => new TextEncoder().encode(s);
const RULES = enc("# Rules\n\nRun every gate.\n");
const EDITED = enc("# Rules\n\nSkip the gates.\n");
const A = "AGENTS.md";
const file = (path: string, bytes = RULES, links = 1): CheckoutEntry => ({
  kind: "file",
  path,
  bytes,
  links,
  id: `1:${path}`,
});
const blob = (path: string, bytes = RULES): BaseEntry => ({ kind: "blob", path, bytes });
const walked = (...entries: CheckoutEntry[]): CheckoutWalk[] => [{ kind: "walked", entries }];
const NOT_HEAD = INSTRUCTION_REASON.notHead;

function judge(over: Partial<InstructionInput> & Pick<InstructionInput, "tree" | "head">) {
  const tip = over.tip ?? [blob(A)];
  const input = { tip, mergeBase: tip, committed: [], symlinks: true, ...over };
  return judgeInstructions(input).map((v) => v.trusted ? "trusted" : `${v.path} ${v.reason}`);
}

Deno.test("a tree and a HEAD that both hold the tip's bytes are trusted", () => {
  assertEquals(judge({ tree: walked(file(A)), head: [blob(A)] }), ["trusted"]);
});

Deno.test("a change committed while the work tree holds the tip's bytes is untrusted", () => {
  assertEquals(judge({ tree: walked(file(A)), head: [blob(A, EDITED)] }), [`${A} ${NOT_HEAD}`]);
});

Deno.test("a work tree at the merge base's bytes over another HEAD is not behind", () => {
  const old = enc("# Rules\n");
  const over = { tip: [blob(A)], mergeBase: [blob(A, old)] };
  assertEquals(judge({ ...over, tree: walked(file(A, old)), head: [blob(A, old)] }), [
    `${A} ${REASON.behind}`,
  ]);
  assertEquals(judge({ ...over, tree: walked(file(A, old)), head: [blob(A, EDITED)] }), [
    `${A} ${NOT_HEAD}`,
  ]);
});

Deno.test("a file HEAD commits that the tree lacks, or lacks that the tree holds, is untrusted", () => {
  const addendum = ".specnaut/addenda/task/merge.md";
  assertEquals(judge({ tree: walked(file(A)), head: [blob(A), blob(addendum)] }), [
    `${addendum} ${NOT_HEAD}`,
  ]);
  assertEquals(judge({ tree: walked(file(A)), head: [] }), [`${A} ${NOT_HEAD}`]);
  assertEquals(judge({ tree: walked(file(A), file(addendum)), head: [blob(A)] }), [
    `${addendum} ${NOT_HEAD}`,
  ]);
});

Deno.test("a tree that differs from HEAD only in line endings says so, or keeps what HEAD changed", () => {
  const crlf = (b: Uint8Array) => enc(new TextDecoder().decode(b).replaceAll("\n", "\r\n"));
  assertEquals(judge({ tree: walked(file(A, crlf(RULES))), head: [blob(A)] }), [
    `${A} ${REASON.lineEndings}`,
  ]);
  assertEquals(judge({ tree: walked(file(A, crlf(EDITED))), head: [blob(A, EDITED)] }), [
    `${A} ${REASON.differs}`,
  ]);
});

Deno.test("a reason about the tree's own shape stands over the HEAD one", () => {
  assertEquals(judge({ tree: walked(file(A, RULES, 2)), head: [blob(A, EDITED)] }), [
    `${A} ${REASON.hardLinked}`,
  ]);
});

Deno.test("a HEAD entry that is not the tip's differs, though the tree holds both", () => {
  // Where links are off, git writes the tip's link and HEAD's file of its target alike.
  const tip: BaseEntry[] = [{ kind: "link", path: "CLAUDE.md", target: A }];
  const tree = walked(file("CLAUDE.md", enc(A)));
  assertEquals(judge({ tip, tree, head: [blob("CLAUDE.md", enc(A))], symlinks: false }), [
    `CLAUDE.md ${REASON.differs}`,
  ]);
  assertEquals(judge({ tip, tree, head: tip, symlinks: false }), ["trusted"]);
});

const overrides = (committed: CommittedInstruction[]) =>
  judge({ tree: walked(), head: [], tip: [], committed });
const on = (s: string) => ({ kind: "file" as const, bytes: enc(s) });
const none = { kind: "absent" as const };
const committed = (path: string, head: ConfigFile, tip: ConfigFile, mergeBase = tip) => [
  { path, head, tip, mergeBase },
];

Deno.test("a committed override the tip lacks is named; one only in the work tree is not", () => {
  for (const path of ["AGENTS.override.md", "CLAUDE.local.md"]) {
    assertEquals(overrides(committed(path, on("x"), none)), [
      `${path} ${REASON.notOnBase}`,
    ]);
    assertEquals(overrides(committed(path, none, none)), ["trusted"]);
  }
});

Deno.test("a committed override that differs from the tip's is named; the same one is not", () => {
  for (const path of ["AGENTS.override.md", "CLAUDE.local.md"]) {
    assertEquals(overrides(committed(path, on("y"), on("x"))), [
      `${path} ${REASON.differs}`,
    ]);
    assertEquals(overrides(committed(path, on("x"), on("x"))), ["trusted"]);
    assertEquals(overrides(committed(path, on("y"), on("x"), on("y"))), [
      `${path} ${REASON.behind}`,
    ]);
  }
});

Deno.test("a committed override that differs from the tip's only in line endings says so", () => {
  const verdict = overrides(committed("CLAUDE.local.md", on("x\r\n"), on("x\n")));
  assertEquals(verdict, [`CLAUDE.local.md ${REASON.lineEndings}`]);
});

Deno.test("the committed overrides are the ones a session loads beside the instruction files", () => {
  assertEquals(COMMITTED_INSTRUCTIONS, ["AGENTS.override.md", "CLAUDE.local.md"]);
});
