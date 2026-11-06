import { fromFileUrl } from "@std/path";
import { git } from "./collect_audit_scope_fixture.ts";

/**
 * The harness the `git-read.sh` tests share: the script, its library, a runner
 * that can set the environment, and planted programs that leave a marker when
 * something runs them. Each plant gets a positive control in the tests — plain
 * git runs it — so a marker that stays absent under the library means the
 * library turned it off, not that the plant was dead.
 */

export const SCRIPT = fromFileUrl(
  new URL("../../templates/core/specnaut/scripts/bash/git-read.sh", import.meta.url),
);
export const LIBRARY = fromFileUrl(
  new URL("../../templates/core/specnaut/scripts/bash/_git_untrusted.sh", import.meta.url),
);

export type Result = { code: number; stdout: string; stderr: string };

const IDENTITY = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

/** Runs `cmd` in `cwd` with `env` on top of the inherited environment. */
export async function runIn(
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<Result> {
  const out = await new Deno.Command(cmd, {
    args,
    cwd,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    env: { HOME: cwd, ...env },
  }).output();
  const d = new TextDecoder();
  return { code: out.code, stdout: d.decode(out.stdout), stderr: d.decode(out.stderr) };
}

/** Plain git, as an agent's shell would run it: the positive control. */
export function plainGit(args: string[], cwd: string, env: Record<string, string> = {}) {
  return runIn("git", args, cwd, { ...IDENTITY, ...env });
}

/** `git-read.sh <args>`; `noglob` keeps a wildcard argument as typed on Windows. */
export function gitRead(args: string[], cwd: string, env: Record<string, string> = {}) {
  const e: Record<string, string> = { ...env };
  if (Deno.build.os === "windows") e.MSYS = "noglob";
  return runIn("bash", [SCRIPT, ...args], cwd, e);
}

/** The library's runner on a fixed argv, as a script that sources it calls it. */
export function libraryGit(args: string[], cwd: string, env: Record<string, string> = {}) {
  const e: Record<string, string> = { ...env };
  if (Deno.build.os === "windows") e.MSYS = "noglob";
  const lib = LIBRARY.replaceAll("\\", "/");
  return runIn("bash", ["-c", '. "$1"; shift; _gu_git "$@"', "_", lib, ...args], cwd, e);
}

/** Forward slashes: git runs these programs through a shell, which reads `\` as an escape. */
export const slash = (p: string) => p.replaceAll("\\", "/");

/** A directory of programs; `plant(name)` writes one that leaves `ran-<name>` when run. */
export class Plants {
  private constructor(readonly dir: string) {}

  static async create(): Promise<Plants> {
    return new Plants(await Deno.makeTempDir({ prefix: "git-read-plants-" }));
  }

  async plant(name: string, at = `${this.dir}/${name}.sh`): Promise<string> {
    const marker = slash(`${this.dir}/ran-${name}`);
    await Deno.writeTextFile(at, `#!/bin/sh\ntouch "${marker}"\nexit 1\n`);
    await Deno.chmod(at, 0o755);
    return slash(at);
  }

  /** The names of the programs that ran, sorted; clears them. */
  async ran(): Promise<string[]> {
    const out: string[] = [];
    for await (const e of Deno.readDir(this.dir)) {
      if (!e.name.startsWith("ran-")) continue;
      out.push(e.name.slice(4));
      await Deno.remove(`${this.dir}/${e.name}`);
    }
    return out.sort();
  }

  remove(): Promise<void> {
    return Deno.remove(this.dir, { recursive: true });
  }
}

/** A commit carrying a signature block of `kind` on top of HEAD, at refs/heads/signed-<kind>. */
export async function signedCommit(dir: string, kind: "openpgp" | "ssh" | "x509"): Promise<void> {
  const header = { openpgp: "PGP SIGNATURE", ssh: "SSH SIGNATURE", x509: "SIGNED MESSAGE" }[kind];
  const tree = (await git(["rev-parse", "HEAD^{tree}"], dir)).trim();
  const parent = (await git(["rev-parse", "HEAD"], dir)).trim();
  const who = "Test <test@example.com> 1700000000 +0000";
  const sig = ` -----BEGIN ${header}-----\n \n AAAA\n -----END ${header}-----`;
  const body = `tree ${tree}\nparent ${parent}\nauthor ${who}\ncommitter ${who}\n` +
    `gpgsig${sig}\n\nchore: a ${kind} signed commit\n`;
  const sha = (await git(["hash-object", "-t", "commit", "-w", "--stdin"], dir, body)).trim();
  await git(["update-ref", `refs/heads/signed-${kind}`, sha], dir);
}

/** A repo with two commits that both touch `notes.txt`, `data.bin` and `deno.json`. */
export async function twoCommitRepo(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "git-read-repo-" });
  await git(["init", "-b", "main"], dir);
  for (const n of ["1", "2"]) {
    await Deno.writeTextFile(`${dir}/notes.txt`, `version ${n}\n`);
    await Deno.writeTextFile(`${dir}/data.bin`, `bytes ${n}\n`);
    await Deno.writeTextFile(`${dir}/deno.json`, `{ "n": ${n} }\n`);
    await git(["add", "."], dir);
    await git(["commit", "-m", `chore: commit ${n}`], dir);
  }
  return dir;
}

export async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}
