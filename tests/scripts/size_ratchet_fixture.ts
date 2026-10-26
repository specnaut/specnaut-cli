// Shared fixture for the `size-ratchet.sh` tests: a throwaway git repo with a
// file at a chosen size and an optional constitution, and a runner that
// captures the script's exit code and both streams.

import { fromFileUrl, join } from "@std/path";

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

export const TABLE = (file: string, exempt = "") =>
  `# Constitution\n\n## Size limits\n\n| Unit | Target | Ceiling |\n| :--- | ---: | ---: |\n${file}\n| function | 30 | 50 |\n${exempt}\n## Next\n`;

/** A repo with `big.ts` committed at `start` lines and the constitution given. */
export async function repo(start: number, constitution?: string): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "size-ratchet-" });
  await run("git", ["init", "-q"], dir);
  await Deno.writeTextFile(join(dir, "big.ts"), lines(start));
  if (constitution !== undefined) {
    await Deno.mkdir(join(dir, ".specnaut/memory"), { recursive: true });
    await Deno.writeTextFile(join(dir, ".specnaut/memory/constitution.md"), constitution);
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
export const isWindows = Deno.build.os === "windows";
