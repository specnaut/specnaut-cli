import { join } from "@std/path";
import { exists } from "./fs_exists.ts";

/**
 * A `git` a checkout could hold, for asserting the binary never starts it: a POSIX script that
 * records it ran and fails. On Windows, a `git.exe` that is the system's `whoami.exe`: it leaves
 * no mark, so `ran` says nothing there, and fails on git's arguments, so a caller asserting what
 * git printed is what proves it never ran.
 */
export async function plantGit(dir: string, fired: string): Promise<void> {
  await Deno.mkdir(dir, { recursive: true });
  if (Deno.build.os === "windows") {
    const system = join(Deno.env.get("SystemRoot") ?? "C:\\Windows", "System32");
    return await Deno.copyFile(join(system, "whoami.exe"), join(dir, "git.exe"));
  }
  const fake = `#!/bin/sh\necho planted >'${fired}'\nexit 1\n`;
  await Deno.writeTextFile(join(dir, "git"), fake, { mode: 0o755 });
}

/** Whether a planted git ran. */
export const ran = (fired: string) => exists(fired);

/** `fn` with the process PATH set to `entries`, the caller's PATH restored after. */
export async function withPath<T>(entries: string[], fn: () => Promise<T>): Promise<T> {
  const before = Deno.env.get("PATH");
  Deno.env.set("PATH", entries.join(Deno.build.os === "windows" ? ";" : ":"));
  try {
    return await fn();
  } finally {
    if (before === undefined) Deno.env.delete("PATH");
    else Deno.env.set("PATH", before);
  }
}

/** The caller's PATH as entries, for appending after a planted folder. */
export const callerPath = () =>
  (Deno.env.get("PATH") ?? "").split(Deno.build.os === "windows" ? ";" : ":");
