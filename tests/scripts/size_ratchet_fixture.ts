// Shared fixture for the `size-ratchet.sh` tests: a throwaway git repo with a
// file at a chosen size, an optional `.specnaut/size-limits.yml` and an
// optional constitution, and a runner that captures the script's exit code
// and both streams.

import { fromFileUrl, join } from "@std/path";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";
import { CONSTITUTION_PATH, SIZE_LIMITS_CONFIG_PATH } from "../../src/domain/constitution_paths.ts";

/** Forward slashes on Windows (`bashPath`), as every other bash-driven script test passes it. */
export const SCRIPT = bashPath(fromFileUrl(
  new URL("../../templates/core/specnaut/scripts/bash/size-ratchet.sh", import.meta.url),
));

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
 * Only the cases that plant a symlink skip Windows: `Deno.symlink` there needs
 * a privilege (or Developer Mode) the runner is not known to grant, so a red
 * would measure the runner, not the script. Every other case runs, through the
 * `bash` the hook and git-sandbox tests already run on the Windows runner, with
 * the script path from `bashPath` (cli#704).
 */
export const symlinkUnsure = Deno.build.os === "windows";

/** The escapes git's core.quotepath names; every other byte it escapes is octal. */
const NAMED: Record<number, string> = {
  0x07: "\\a",
  0x08: "\\b",
  0x09: "\\t",
  0x0a: "\\n",
  0x0b: "\\v",
  0x0c: "\\f",
  0x0d: "\\r",
  0x22: '\\"',
  0x5c: "\\\\",
};

/**
 * `name` as the ratchet prints every path (cli#807), and git with core.quotepath: quoted when it
 * holds a control byte, a byte at or above 0x80, a `"` or a `\`, each such byte escaped. Bytes
 * for a name no string can spell, such as a lone 0x9B.
 */
export function quoted(name: string | Uint8Array): string {
  const bytes = typeof name === "string" ? new TextEncoder().encode(name) : name;
  let out = "";
  let escaped = false;
  for (const b of bytes) {
    const named = NAMED[b];
    if (named !== undefined || b < 0x20 || b >= 0x7f) escaped = true;
    out += named ??
      (b < 0x20 || b >= 0x7f ? `\\${b.toString(8).padStart(3, "0")}` : String.fromCharCode(b));
  }
  return escaped ? `"${out}"` : out;
}
