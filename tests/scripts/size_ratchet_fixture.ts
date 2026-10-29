// Shared fixture for the `size-ratchet.sh` tests: a throwaway git repo with a
// file at a chosen size, an optional `.specnaut/size-limits.yml` and an
// optional constitution, and a runner that captures the script's exit code
// and both streams.

import { fromFileUrl, join } from "@std/path";
import { CONSTITUTION_PATH, SIZE_LIMITS_CONFIG_PATH } from "../../src/domain/constitution_paths.ts";

export const SCRIPT = fromFileUrl(
  new URL("../../templates/core/specnaut/scripts/bash/size-ratchet.sh", import.meta.url),
);

export type Result = { code: number; stdout: string; stderr: string };

export async function run(bin: string, args: string[], cwd: string): Promise<Result> {
  const { code, stdout, stderr } = await new Deno.Command(bin, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
    env: {
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  }).output();
  const d = new TextDecoder();
  return { code, stdout: d.decode(stdout), stderr: d.decode(stderr) };
}

export const lines = (n: number) =>
  Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n") + "\n";

/** A `size-limits.yml` unit block. */
export const UNIT = (unit: string, target: number | string, ceiling: number | string) =>
  `${unit}:\n  target: ${target}\n  ceiling: ${ceiling}\n`;

/** A `size-limits.yml` setting the `file` unit, plus whatever else is given. */
export const FILE = (target: number | string, ceiling: number | string, rest = "") =>
  UNIT("file", target, ceiling) + UNIT("function", 30, 50) + rest;

/** An `exempt:` list. */
export const EXEMPT = (...globs: string[]) =>
  `exempt:\n${globs.map((g) => `  - "${g}"\n`).join("")}`;

/**
 * A repo with `big.ts` committed at `start` lines, and the size config and the
 * constitution given.
 */
export async function repo(
  start: number,
  config?: string,
  constitution?: string,
): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "size-ratchet-" });
  await run("git", ["init", "-q"], dir);
  await Deno.writeTextFile(join(dir, "big.ts"), lines(start));
  await Deno.mkdir(join(dir, "docs"), { recursive: true });
  await Deno.mkdir(join(dir, ".specnaut"), { recursive: true });
  if (config !== undefined) await Deno.writeTextFile(join(dir, SIZE_LIMITS_CONFIG_PATH), config);
  if (constitution !== undefined) {
    await Deno.writeTextFile(join(dir, CONSTITUTION_PATH), constitution);
  }
  await run("git", ["add", "-A"], dir);
  await run("git", ["commit", "-q", "-m", "init"], dir);
  return dir;
}

export async function stage(dir: string, path: string, n: number): Promise<void> {
  await Deno.writeTextFile(join(dir, path), lines(n));
  await run("git", ["add", path], dir);
}

export const BASH = "bash";
export const ratchet = (dir: string) => run(BASH, [SCRIPT], dir);
export const CLEAN = "staged file(s) within the file limits";
/**
 * Why the ratchet and boundary-check tests are ignored on Windows: they hand a
 * native `C:\` script path and temp cwd to whichever `bash` PATH resolves
 * first, and on a Windows runner that is not known to be Git Bash (System32's
 * WSL launcher can precede it, and cannot open a `C:\` path). A red there
 * would measure the runner, not the script — so it is reported as ignored,
 * never as a pass.
 */
export const isWindows = Deno.build.os === "windows";
