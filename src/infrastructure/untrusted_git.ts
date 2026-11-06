/**
 * git with hardened defaults, for reading a repository whose configuration nobody vetted: the one
 * home, in TypeScript, of how the binary runs git against such a repository. The shell scripts'
 * home is `templates/core/specnaut/scripts/bash/_git_untrusted.sh`; the flag list below is copied
 * from it, and `tests/infrastructure/untrusted_git_test.ts` holds the two equal.
 *
 * "Read-only" git still runs programs a repository names: a plain `git ls-files` spawns whatever
 * `core.fsmonitor` says. So every call turns off each program or redirection the repository's own
 * configuration could name, takes pathspecs literally, asks for no optional lock, reads no system
 * configuration, and runs with an environment cleared to an allowlist, so no `GIT_*` variable of
 * the caller's reaches it. `safe.directory` is never passed, so a refusal stays a refusal.
 */

/** The defaults `_gu_git` in `_git_untrusted.sh` passes before every subcommand, in its order. */
// deno-fmt-ignore
export const UNTRUSTED_GIT_FLAGS: readonly string[] = [
  "--no-pager", "--no-optional-locks", "--literal-pathspecs",
  "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "log.showSignature=false",
  "-c", "gpg.program=/dev/null/none", "-c", "gpg.openpgp.program=/dev/null/none",
  "-c", "gpg.ssh.program=/dev/null/none", "-c", "gpg.x509.program=/dev/null/none",
  "-c", "submodule.recurse=false", "-c", "diff.submodule=short",
];

/** Passed only to a git that knows it (2.44 or later); below it, a promisor remote is refused. */
export const LAZY_FETCH_FLAG = "--no-lazy-fetch";

/** `_GU_PLAIN`: the flags every form that diffs carries. */
export const PLAIN_DIFF_FLAGS: readonly string[] = ["--no-textconv", "--no-ext-diff", "--no-color"];

/** What `_gu_env_run` exports, plus no system configuration (a file the repository cannot see). */
export const UNTRUSTED_GIT_ENV: Readonly<Record<string, string>> = {
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  GIT_NO_LAZY_FETCH: "1",
  GIT_CONFIG_NOSYSTEM: "1",
};

/**
 * The caller's variables git may still see: where to find programs and the user's own global
 * configuration, the temp folder, the locale, and what Windows needs to start a process at all.
 */
// deno-fmt-ignore
const ENV_ALLOWLIST = [
  "PATH", "HOME", "XDG_CONFIG_HOME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE",
  "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP",
];

/** The subcommands any caller may run: none reads the work tree through a filter or a program. */
export type GitSubcommand =
  | "rev-parse"
  | "ls-files"
  | "check-attr"
  | "symbolic-ref"
  | "merge-base"
  | "rev-list"
  | "ls-tree"
  | "cat-file"
  | "diff-tree"
  | "config";

/** git could not answer: no git, a refused repository, a failed call. */
export class GitRefused extends Error {}

/** A call's raw result, for the callers whose answer is the exit code itself. */
export type GitResult = {
  readonly code: number;
  readonly stdout: Uint8Array;
  readonly why: string;
};

/** The minimal git that knows `--no-lazy-fetch`. */
const LAZY_FETCH_SINCE = [2, 44] as const;
const PROMISOR = "^(extensions\\.partialclone|remote\\..*\\.promisor)$";

let lazySupport: Promise<boolean> | undefined;

/** git, run in one repository under the hardened defaults. */
export class UntrustedGit {
  #lazy: Promise<readonly string[]> | undefined;

  constructor(readonly cwd: string) {}

  /** stdout, or a throw naming why git refused. */
  async run(sub: GitSubcommand, args: readonly string[], input?: Uint8Array): Promise<Uint8Array> {
    const out = await this.call(sub, args, input);
    if (out.code === 0) return out.stdout;
    throw new GitRefused(`git ${sub} failed: ${out.why || `exit ${out.code}`}`);
  }

  /** The exit code and stdout, never a throw for a non-zero exit. */
  async call(sub: GitSubcommand, args: readonly string[], input?: Uint8Array): Promise<GitResult> {
    const lazy = await (this.#lazy ??= this.#lazyFlags());
    return spawnGit(
      this.cwd,
      [...UNTRUSTED_GIT_FLAGS, ...lazy, ...READ_CONFIG, sub, ...args],
      input,
    );
  }

  /** `--no-lazy-fetch` when git knows it; below 2.44 a promisor remote is refused, not read. */
  async #lazyFlags(): Promise<readonly string[]> {
    if (await (lazySupport ??= knowsLazyFetch(this.cwd))) return [LAZY_FETCH_FLAG];
    const args = [...UNTRUSTED_GIT_FLAGS, "config", "--get-regexp", PROMISOR];
    const probe = await spawnGit(this.cwd, args);
    if (probe.code === 0) {
      throw new GitRefused(
        "a promisor remote is configured and this git predates --no-lazy-fetch (2.44)",
      );
    }
    return [];
  }
}

/** Names as git stores them, never C-quoted: every caller reads a NUL-separated or raw list. */
const READ_CONFIG = ["-c", "core.quotePath=false"];

async function knowsLazyFetch(cwd: string): Promise<boolean> {
  const out = await spawnGit(cwd, ["version"]);
  const m = /(\d+)\.(\d+)/.exec(new TextDecoder().decode(out.stdout));
  if (out.code !== 0 || m === null) return false;
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return major > LAZY_FETCH_SINCE[0] ||
    (major === LAZY_FETCH_SINCE[0] && minor >= LAZY_FETCH_SINCE[1]);
}

/** The environment git runs with: the allowlist, then the hardened variables. */
export function untrustedGitEnv(
  source: (name: string) => string | undefined,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ENV_ALLOWLIST) {
    const value = source(name);
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...UNTRUSTED_GIT_ENV };
}

/** The one spawn of git in the binary's reads of an unvetted repository. */
async function spawnGit(cwd: string, args: string[], input?: Uint8Array): Promise<GitResult> {
  const child = start(cwd, args, input !== undefined);
  const [out] = await Promise.all([child.output(), input && writeAll(child.stdin, input)]);
  const why = new TextDecoder().decode(out.stderr).trim().split("\n")[0].slice(0, 300);
  return { code: out.code, stdout: out.stdout, why };
}

function start(cwd: string, args: string[], piped: boolean): Deno.ChildProcess {
  const command = new Deno.Command("git", {
    args,
    cwd,
    clearEnv: true,
    env: untrustedGitEnv((name) => Deno.env.get(name)),
    stdin: piped ? "piped" : "null",
    stdout: "piped",
    stderr: "piped",
  });
  try {
    return command.spawn();
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) throw new GitRefused("git is not on the PATH");
    throw err;
  }
}

async function writeAll(stream: WritableStream<Uint8Array>, bytes: Uint8Array): Promise<void> {
  const writer = stream.getWriter();
  await writer.write(bytes);
  await writer.close();
}
