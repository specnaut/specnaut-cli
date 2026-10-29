import { assert, assertEquals } from "@std/assert";
import {
  exactMoveRefusal,
  moveExact,
  NOT_EXACT,
} from "../../src/application/upgrade_exact_move.ts";
import { fakeWriter } from "./upgrade_fakes.ts";

/**
 * Spec 038 (A-M2): the one byte move every mover shares — the write, then a
 * delete bounded to the old address — and the one wording of its refusals.
 */

const FROM = "docs/old.md";
const TO = "docs/new.md";

Deno.test("a move writes the bytes at the new address and deletes the old one", async () => {
  const writer = fakeWriter();
  const notes: string[] = [];
  const outcome = await moveExact({ writer, projectDir: "/p", notes }, FROM, FROM, TO, "x\r\n");
  assertEquals(outcome, "moved");
  assertEquals(writer.written.get(TO), "x\r\n");
  assertEquals(writer.deleted, [FROM]);
  assertEquals(writer.deleteBackupsRequested, false, "a moved file owes no backup");
  assertEquals(notes, [`note: tidied after ${FROM}`], "the writer's own notes reach the caller");
});

Deno.test("an old address that resolves elsewhere is copied, never deleted where it lands", async () => {
  const writer = fakeWriter({ [FROM]: "elsewhere/old.md" });
  const notes: string[] = [];
  const outcome = await moveExact({ writer, projectDir: "/p", notes }, FROM, FROM, TO, "x");
  assertEquals(outcome, "copied");
  assertEquals(writer.deleted, []);
  assertEquals(notes, [
    `${FROM} was copied to ${TO} but not deleted: it resolves to another path — ` +
    `delete the old copy yourself once you have checked it`,
  ]);
});

Deno.test("a write that fails moves nothing and deletes nothing, and says so", async () => {
  const writer = fakeWriter();
  writer.writeBundle = () => Promise.reject(new Error("disk full"));
  const notes: string[] = [];
  const outcome = await moveExact({ writer, projectDir: "/p", notes }, "addendum x", FROM, TO, "x");
  assertEquals(outcome, "failed");
  assertEquals(writer.deleted, []);
  assertEquals(notes, [`addendum x is not moved to ${TO}: disk full`]);
});

Deno.test("a delete that fails after the write is a copy, not a failed move", async () => {
  const writer = fakeWriter();
  writer.deletePaths = () => Promise.reject(new Error("busy"));
  const notes: string[] = [];
  const outcome = await moveExact({ writer, projectDir: "/p", notes }, FROM, FROM, TO, "x");
  assertEquals(outcome, "copied");
  assertEquals(writer.written.get(TO), "x");
  assertEquals(notes, [`${FROM} was copied to ${TO} but not deleted: busy`]);
});

Deno.test("each refusal reads the same from every mover", () => {
  assertEquals(
    exactMoveRefusal({ kind: "target-occupied" }, "addendum a", "b"),
    "addendum a is not moved to b: a file is already there, and it is kept as it is — " +
      "merge the two by hand",
  );
  assertEquals(
    exactMoveRefusal({ kind: "source-link" }, "a", "b"),
    "a is a link, so it is not moved to b — upgrade never copies through a link; " +
      "point it at the new address yourself",
  );
  assertEquals(
    exactMoveRefusal({ kind: "source-lossy" }, "a", "b"),
    `a is not moved to b: ${NOT_EXACT}`,
  );
  assert(NOT_EXACT.includes("not valid UTF-8"));
});

Deno.test("a move that can go ahead, or has nothing to move, is not a refusal", () => {
  assertEquals(exactMoveRefusal({ kind: "ok", content: "" }, "a", "b"), null);
  assertEquals(exactMoveRefusal({ kind: "no-source" }, "a", "b"), null);
});
