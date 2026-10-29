import { join } from "@std/path";

/**
 * Lock-file fixtures shared by the upgrade integration tests that plant a
 * project state an older release would have left: files on disk, and the lock
 * rows recording what was installed. They write the lock's text form directly —
 * the point is to reproduce what a past release wrote, not what today's lock
 * store would.
 */

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const lockPath = (dir: string) => join(dir, ".specnaut/installed.lock");

async function lockRow(rel: string, recorded: string): Promise<string> {
  return `  ${rel}:\n    sha256: ${await sha256(recorded)}\n` +
    `    installed_at: "2026-01-01T00:00:00Z"\n    templates_version: 6.0.0\n`;
}

/** Write `rel` with `body` and record it in the lock as installed with `recorded`. */
export async function plant(
  dir: string,
  entries: Array<[rel: string, body: string, recorded: string]>,
) {
  let lock = await Deno.readTextFile(lockPath(dir));
  for (const [rel, body, recorded] of entries) {
    await Deno.mkdir(join(dir, rel, ".."), { recursive: true });
    await Deno.writeTextFile(join(dir, rel), body);
    lock += await lockRow(rel, recorded);
  }
  await Deno.writeTextFile(lockPath(dir), lock);
}

/** Record `rel` in the lock as installed with `recorded`, writing nothing on disk. */
export async function appendLock(dir: string, entries: Array<[rel: string, recorded: string]>) {
  let lock = await Deno.readTextFile(lockPath(dir));
  for (const [rel, recorded] of entries) lock += await lockRow(rel, recorded);
  await Deno.writeTextFile(lockPath(dir), lock);
}

export const lockText = (dir: string) => Deno.readTextFile(lockPath(dir));
