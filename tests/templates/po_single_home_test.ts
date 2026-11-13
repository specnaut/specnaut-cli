import { assert } from "@std/assert";
import { restates } from "./po_single_home.ts";

/**
 * The single-home guard's own reading of lists and deciders (cli#789): what it
 * must flag and what it must let through, beside the phrasings
 * po_decides_classification_test.ts holds.
 */

/** A numbered list of steps, one of them leading a nested list, as groom.md writes it. */
const NESTED = [
  "- For each item, the product owner decides each value:",
  "",
  "  1. **Rewrite the body.** Keep it readable.",
  "  2. **Assign a value.** Apply exactly one of:",
  "     - `XS` for a trivial change",
  "     - `S` for a single file",
  "  3. **Assign the priority of the item.**",
  "  4. **Assign the size of the item.**",
].join("\n");

Deno.test("a nested lead leaves the outer list open: its later items are read", () => {
  assert(restates(NESTED), "the items after the nested list were not read");
});

Deno.test("the nested list's items are read with the outer list they sit in", () => {
  const text = [
    "The product owner decides these:",
    "",
    "- the order:",
    "  - the priority of the item.",
    "  - the size of the item.",
  ].join("\n");
  assert(restates(text), "the nested items were not read with the outer lead");
});

Deno.test("an indented paragraph continues its item: the list stays open", () => {
  const text = [
    "The product owner decides:",
    "",
    "- the priority of every item.",
    "",
    "  It is reported in one line.",
    "",
    "- the size of every item.",
  ].join("\n");
  assert(restates(text), "the continuation closed the list");
});

Deno.test("an indented paragraph ending with a colon leads the list under it", () => {
  const text = [
    "- Every new item:",
    "",
    "  Here the product owner decides:",
    "",
    "  - the priority.",
    "  - the size.",
  ].join("\n");
  assert(restates(text), "the continuation was not read as a lead");
});

Deno.test("an indented lead owns only what is indented under it", () => {
  const text = [
    "- Every new item:",
    "",
    "  Here the product owner decides:",
    "",
    "  - the priority.",
    "",
    "- the size of the item.",
  ].join("\n");
  assert(!restates(text), "a sibling of the outer item was read as the indented lead's");
});

Deno.test("a paragraph after the list closes it", () => {
  const text = [
    "The product owner decides the order:",
    "",
    "- one at a time.",
    "",
    "The priority and size are fields:",
    "",
    "- shown on the board.",
  ].join("\n");
  assert(!restates(text), "a list was read past the paragraph that ends it");
});

Deno.test("a decider is a whole word on both sides: no word that merely holds one", () => {
  for (const who of ["superuser", "steam", "steamer"]) {
    const text = `The ${who} sets the priority and size fields in one request.`;
    assert(!restates(text), `"${who}" was read as a decider`);
  }
  const board = "Priority and size changes are made by the leaderboard job.";
  assert(!restates(board), `"leaderboard" was read as a decider`);
  assert(restates("The user sets the priority and size fields in one request."));
});

Deno.test("a fenced block between items leaves the list open", () => {
  const text = [
    "The product owner decides:",
    "",
    "- the priority of every item.",
    "",
    "  ```sh",
    "  read-items.sh",
    "  ```",
    "",
    "- the size of every item.",
  ].join("\n");
  assert(restates(text), "the code block closed the list");
});

Deno.test("a heading ending with a colon leads a list; a table row never does", () => {
  const list = "\n\n- the priority of every item.\n- the size of every item.";
  assert(restates(`## What the product owner decides:${list}`), "the heading was not a lead");
  assert(!restates(`| The product owner decides: |${list}`), "a table row was read as a lead");
});
