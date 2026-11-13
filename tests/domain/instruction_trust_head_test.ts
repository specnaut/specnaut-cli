import { assertEquals } from "@std/assert";
import { LINK_REASON } from "../../src/domain/checkout_link.ts";
import { INSTRUCTION_REASON } from "../../src/domain/instruction_trust.ts";
import type { CheckoutWalk } from "../../src/domain/checkout_trust.ts";
import { type BaseEntry, REASON } from "../../src/domain/script_trust.ts";
import { A, blob, enc, file, judge, RULES, walked } from "./instruction_trust_fixture.ts";

/**
 * What lands is HEAD's commit, so the instruction class is judged there as well as in the work
 * tree: a work tree that does not hold HEAD's entry is untrusted, whatever it holds against the
 * tip, and the overrides are read from HEAD alone.
 */

const EDITED = enc("# Rules\n\nSkip the gates.\n");
const NOT_HEAD = INSTRUCTION_REASON.notHead;

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

Deno.test("a HEAD that changed only line endings over a tree at the merge base is not behind", () => {
  const old = enc("# Rules\n");
  const over = { tip: [blob(A)], mergeBase: [blob(A, old)], tree: walked(file(A, old)) };
  assertEquals(judge({ ...over, head: [blob(A, enc("# Rules\r\n"))] }), [
    `${A} ${REASON.lineEndings}`,
  ]);
});

Deno.test("HEAD's files under a folder the walk could not enter are not named again", () => {
  const tree: CheckoutWalk[] = [
    { kind: "walked", entries: [file(A)] },
    { kind: "blocked", path: ".specnaut/addenda", why: REASON.link },
  ];
  const head = [blob(A), blob(".specnaut/addenda/task/merge.md")];
  assertEquals(judge({ tree, head, tip: [blob(A)] }), [`.specnaut/addenda ${REASON.link}`]);
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
  const tip: BaseEntry[] = [blob(A), { kind: "link", path: "CLAUDE.md", target: A }];
  const tree = walked(file(A), file("CLAUDE.md", enc(A)));
  const head = [blob(A), blob("CLAUDE.md", enc(A))];
  assertEquals(judge({ tip, tree, head, symlinks: false }), [`CLAUDE.md ${REASON.differs}`]);
  assertEquals(judge({ tip, tree, head: tip, symlinks: false }), ["trusted"]);
});

Deno.test("a committed link out of the class is named where links are off, whatever the tree shows", () => {
  // Where links are off, the tree holds the target's text, which the tip check takes as the link.
  const link: BaseEntry = { kind: "link", path: "CLAUDE.md", target: "notes/rules.md" };
  const tree = walked(file("CLAUDE.md", enc("notes/rules.md")));
  assertEquals(judge({ tip: [link], tree, head: [link], symlinks: false }), [
    `CLAUDE.md ${LINK_REASON.linkLeaves}`,
  ]);
});

Deno.test("an instruction file HEAD changes to hold invisible characters is named so", () => {
  const hidden = enc("# Rules\n\nRun every gate.\u202e\n");
  assertEquals(judge({ tree: walked(file(A, hidden)), head: [blob(A, hidden)] }), [
    `${A} ${INSTRUCTION_REASON.invisible}: U+202E (line 3)`,
  ]);
  // The tip's own bytes are not the branch's change: nothing is asked.
  const tip = [blob(A, hidden)];
  assertEquals(judge({ tip, tree: walked(file(A, hidden)), head: tip }), ["trusted"]);
});
