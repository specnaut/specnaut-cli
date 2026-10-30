import { assertEquals } from "@std/assert";
import type { FsReader, FsWriter } from "../../src/application/ports.ts";
import { carryAddenda } from "../../src/application/upgrade_addenda_moves.ts";
import { addendumPath, addendumRenames } from "../../src/domain/addendum_audit.ts";

/**
 * cli#709 — three moves end at `task/implement` (the original `implement`
 * move and the two `tasks` folds). A real upgrade carries the first and refuses
 * the rest; the dry run must say exactly that, not "would move" three times.
 *
 * The check is differential: the same tree is run for real and as a dry run,
 * and the dry run's notes must be the real run's with "moved" read as "would
 * move". Asserting the dry run alone would only restate its own logic.
 */

/** A reader and a writer over ONE in-memory disk, so a move is seen by the next one. */
function liveDisk(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  const reader: FsReader = {
    readText: (_d, rel) => Promise.resolve(files.get(rel) ?? null),
    readEntry: (_d, rel) => {
      const content = files.get(rel);
      return Promise.resolve(content === undefined ? null : { kind: "file", content });
    },
    listFiles: () => Promise.resolve([]),
  };
  const writer: FsWriter = {
    detectConflicts: () => Promise.resolve([]),
    writeBundle: (bundle) => {
      for (const [dest, file] of Object.entries(bundle)) files.set(dest, file.content);
      return Promise.resolve({ backups: [], skippedSkipIfExists: [] });
    },
    deletePaths: (paths) => {
      for (const p of paths) files.delete(p);
      return Promise.resolve({ backups: [], skippedSkipIfExists: [] });
    },
  };
  return { files, reader, writer };
}

async function run(initial: Record<string, string>, dryRun: boolean) {
  const disk = liveDisk(initial);
  const notes: string[] = [];
  await carryAddenda({ ...disk, projectDir: "/p", dryRun, notes });
  return { notes, files: disk.files };
}

const at = (skill: "specnaut" | "task", phase: string) => addendumPath({ skill, phase });
const IMPLEMENT = at("task", "implement");

Deno.test("the fixture's three sources all end at task/implement", () => {
  // Non-vacuity: if the table stops routing these three here, the collision
  // below is no longer the one the upgrade can meet.
  const into = addendumRenames().filter((m) => addendumPath(m.to) === IMPLEMENT)
    .map((m) => addendumPath(m.from)).sort();
  assertEquals(into, [at("specnaut", "implement"), at("specnaut", "tasks"), at("task", "tasks")]);
});

Deno.test("dry run reports what the real run does when three addenda collide on implement", async () => {
  const tree = {
    [at("specnaut", "implement")]: "old implement step\n",
    [at("task", "tasks")]: "tasks step\n",
    [at("specnaut", "tasks")]: "older tasks step\n",
  };
  const real = await run(tree, false);
  const dry = await run(tree, true);

  // The real run carries the first and keeps the other two where they are.
  assertEquals(real.files.get(IMPLEMENT), "old implement step\n");
  assertEquals(real.files.get(at("task", "tasks")), "tasks step\n");
  assertEquals(real.files.get(at("specnaut", "tasks")), "older tasks step\n");
  assertEquals(real.notes.filter((n) => n.includes("already there")).length, 2);

  assertEquals(
    dry.notes,
    real.notes.map((n) => n.replace(/^(addendum \S+) moved to /, "$1 would move to ")),
  );
  assertEquals(dry.files, new Map(Object.entries(tree)), "a dry run changed the disk");
});

Deno.test("dry run and real run agree when tasks and implement addenda both already exist", async () => {
  const tree = { [at("task", "tasks")]: "tasks step\n", [IMPLEMENT]: "implement step\n" };
  const real = await run(tree, false);
  const dry = await run(tree, true);

  assertEquals(real.files, new Map(Object.entries(tree)), "a move wrote over an addendum");
  assertEquals(dry.notes, real.notes);
  assertEquals(real.notes.length, 1);
});
