import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ADDENDA_ROOT } from "../../src/domain/addendum_audit.ts";
import { retiredConfigNotices } from "../../src/application/upgrade_retired_notices.ts";
import { DenoFsReader } from "../../src/infrastructure/fs_reader.ts";
import { checkAddenda } from "../../src/infrastructure/fs_phase_routing_checks.ts";
import { WINDOWS } from "../helpers/link_text.ts";

/**
 * Two walkers read `.specnaut/addenda/`: `listFiles`, which upgrade's
 * retired-agent notice reads through, and the doctor's (`check --project`).
 * They used to disagree about links — the doctor counted every link, the
 * reader skipped them all — so an addendum symlinked inside the project was
 * read by the router but never by the notice (cli#712). One rule now, the
 * reader's: a link that lands on a regular file inside the project is a file;
 * a link that leaves the project, dangles or names a folder is not walked.
 */

async function withLinkedAddenda(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-addenda-links-" });
  const outside = await Deno.makeTempDir({ prefix: "specnaut-outside-" });
  try {
    const task = join(dir, ADDENDA_ROOT, "task");
    await Deno.mkdir(task, { recursive: true });
    await Deno.mkdir(join(dir, "shared"));
    await Deno.writeTextFile(join(dir, "shared/review.md"), "Dispatch `review-coordinator`.\n");
    await Deno.writeTextFile(join(outside, "x.md"), "Dispatch `qa-tester`.\n");
    // Every name below is misaddressed, so the doctor warns about each one it walks.
    await Deno.writeTextFile(join(task, "plann.md"), "a regular file\n");
    await Deno.symlink("../../../shared/review.md", join(task, "reveiw.md"));
    await Deno.symlink(join(outside, "x.md"), join(task, "escapes.md"));
    await Deno.symlink("../../../shared/absent.md", join(task, "dangles.md"));
    await Deno.symlink("../../../shared", join(task, "folder"));
    // Through a regular file: lstat throws NotADirectory, which must not abort the walk.
    await Deno.symlink("../../../shared/review.md/x", join(task, "through-file.md"));
    await Deno.symlink("loops.md", join(task, "loops.md")); // FilesystemLoop
    await Deno.symlink("../../../nope/x.md", join(task, "missing-dir.md")); // UnwalkableLinkError
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
}

const IN_PROJECT = [`${ADDENDA_ROOT}/task/plann.md`, `${ADDENDA_ROOT}/task/reveiw.md`];

Deno.test("listFiles and the doctor walk the same addenda when some are links", {
  ignore: WINDOWS,
}, async () => {
  await withLinkedAddenda(async (dir) => {
    assertEquals(await new DenoFsReader().listFiles(dir, ADDENDA_ROOT), IN_PROJECT);
    assertEquals((await checkAddenda(dir)).map((o) => o.name), IN_PROJECT);
  });
});

Deno.test("an addendum linked inside the project that names a retired agent is named by upgrade", {
  ignore: WINDOWS,
}, async () => {
  await withLinkedAddenda(async (dir) => {
    const out = await retiredConfigNotices(new DenoFsReader(), dir, new Set());
    assertEquals(out.slice(0, -1), [
      `${ADDENDA_ROOT}/task/reveiw.md names a retired agent — review-coordinator → ` +
      "the main session runs phases/review.md",
    ]);
  });
});

Deno.test("an addenda folder linked out of the project is one doctor row, not a crashed report", {
  ignore: WINDOWS,
}, async () => {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-addenda-out-" });
  const outside = await Deno.makeTempDir({ prefix: "specnaut-outside-" });
  try {
    await Deno.mkdir(join(dir, ".specnaut"), { recursive: true });
    await Deno.symlink(outside, join(dir, ADDENDA_ROOT));
    const rows = await checkAddenda(dir);
    assertEquals(rows.map((r) => [r.name, r.status]), [[`${ADDENDA_ROOT}/`, "warn"]]);
    assertStringIncludes(rows[0].message, "leaves the project");
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("an addenda folder linked into a loop is one doctor row, not a crashed report", {
  ignore: WINDOWS,
}, async () => {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-addenda-loop-" });
  try {
    await Deno.mkdir(join(dir, ".specnaut"), { recursive: true });
    await Deno.symlink("addenda", join(dir, ADDENDA_ROOT));
    const rows = await checkAddenda(dir);
    assertEquals(rows.map((r) => [r.name, r.status]), [[`${ADDENDA_ROOT}/`, "warn"]]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
