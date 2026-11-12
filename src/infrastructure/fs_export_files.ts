import { dirname, join, relative, SEPARATOR } from "@std/path";
import {
  type ExportHome,
  ExportRefused,
  type TreeObjects,
} from "../application/untrusted_review_ports.ts";
import { formatOf, gitBlobId } from "../domain/git_object_id.ts";
import type { ExportPlan, PlannedFile } from "../domain/tree_plan.ts";
import { isInside } from "../domain/destination.ts";

/**
 * The export's two copies on disk: written file by file, every folder and file created new so no
 * write follows a link or lands on something already there, then the reviewers' copy re-hashed
 * against the commit. The scratch copy is not re-hashed: the sandbox mounts it read-only.
 */

/** How many blobs one `cat-file --batch` reads: the byte cap bounds the total, this the step. */
const BLOB_BATCH = 256;
const windows = Deno.build.os === "windows";

/** Writes each planned file to `seats/` at 0644 and to `scratch/` with its executable bit. */
export async function writeCopies(home: ExportHome, plan: ExportPlan, objects: TreeObjects) {
  const made = new Set([home.seats, home.scratch]);
  for (let i = 0; i < plan.files.length; i += BLOB_BATCH) {
    const batch = plan.files.slice(i, i + BLOB_BATCH);
    const blobs = await objects.readBlobs([...new Set(batch.map((f) => f.sha))]);
    for (const file of batch) {
      const bytes = blobs.get(file.sha)!;
      await writeNew(home.seats, file, bytes, 0o644, made);
      await writeNew(home.scratch, file, bytes, file.executable ? 0o755 : 0o644, made);
    }
  }
}

/** Refuses any file of `seats` that differs from the plan, is extra, is missing or is not 0644. */
export async function verifyCopy(seats: string, plan: ExportPlan): Promise<void> {
  const expected = new Map(plan.files.map((f) => [join(seats, ...f.names), f]));
  const found = await walkFiles(seats);
  for (const path of found) {
    const file = expected.get(path);
    if (file === undefined) throw new ExportRefused(`${path} was not written by the export`);
    if (await gitBlobId(await Deno.readFile(path), formatOf(file.sha)) !== file.sha) {
      throw new ExportRefused(`${path} differs from the commit`);
    }
    if (!windows && ((await Deno.lstat(path)).mode! & 0o777) !== 0o644) {
      throw new ExportRefused(`${path} is not mode 0644`);
    }
  }
  if (found.length !== expected.size) throw new ExportRefused("a planned file is missing");
}

/** Writes one planned file under `base`, the file created new, its folders made new on the way. */
async function writeNew(
  base: string,
  file: PlannedFile,
  bytes: Uint8Array,
  mode: number,
  made: Set<string>,
): Promise<void> {
  const abs = pathIn(base, file);
  await makeParents(base, abs, made);
  const out = await Deno.open(abs, { write: true, createNew: true, mode });
  try {
    let at = 0;
    while (at < bytes.length) at += await out.write(bytes.subarray(at));
  } finally {
    out.close();
  }
  if (!windows) await Deno.chmod(abs, mode);
}

/** The file's path under `base`, strictly inside it and one step per name, or a refusal. */
function pathIn(base: string, file: PlannedFile): string {
  const abs = join(base, ...file.names);
  const rel = relative(base, abs);
  if (rel === "" || !isInside(base, abs) || rel.split(SEPARATOR).length !== file.names.length) {
    throw new ExportRefused(`${file.path} resolves outside the export`);
  }
  return abs;
}

/**
 * Makes each folder between `base` and `abs` this export has not made yet. A `mkdir` that is not
 * recursive fails on anything already there, a link included.
 */
async function makeParents(base: string, abs: string, made: Set<string>): Promise<void> {
  const parents: string[] = [];
  for (let dir = dirname(abs); dir !== base; dir = dirname(dir)) parents.unshift(dir);
  for (const dir of parents) {
    if (made.has(dir)) continue;
    await Deno.mkdir(dir, { mode: 0o755 });
    made.add(dir);
  }
}

/** Every regular file under `dir`, refusing a link or anything else that is not a folder. */
async function walkFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isSymlink) throw new ExportRefused(`${path} is a link`);
    if (entry.isDirectory) files.push(...await walkFiles(path));
    else if (entry.isFile) files.push(path);
    else throw new ExportRefused(`${path} is not a regular file`);
  }
  return files;
}
