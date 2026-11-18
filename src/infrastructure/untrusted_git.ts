import { isAbsolute, join } from "@std/path";
import { type Dropped, filterGitPath, gitMissing } from "./git_path.ts";
import {
  ENV_ALLOWLIST,
  LAZY_FETCH_FLAG,
  UNTRUSTED_GIT_ENV,
  UNTRUSTED_GIT_FLAGS,
} from "./untrusted_git_flags.ts";

/**
 * git with hardened defaults, for reading a repository whose configuration nobody vetted: the one
 * home, in TypeScript, of how the binary runs git against such a repository. The shell scripts'
 * home is `templates/core/specnaut/scripts/bash/_git_untrusted.sh`; its flag list is copied into
 * `untrusted_git_flags.ts`, and `tests/infrastructure/untrusted_git_test.ts` holds the two equal.
 *
 * "Read-only" git still runs programs a repository names: a plain `git ls-files` spawns whatever
 * `core.fsmonitor` says. So every call turns off each program or redirection the repository's own
 * configuration could name, takes pathspecs literally, asks for no optional lock, reads no system
 * configuration, follows no replace ref and no grafts file (a repository holding one is refused),
 * and runs with an environment cleared to an allowlist, so no `GIT_*` variable of the caller's
 * reaches it, and git itself is found on no PATH entry the tree could supply (`git_path.ts`).
 * `safe.directory` is never passed, so a refusal stays a refusal.
 */

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

/** git's environment, and the first PATH entry left out of it. */
export type GitEnv = {
  readonly env: Record<string, string>;
  readonly dropped: Dropped | undefined;
};

/** Where git runs, and the environment it starts with. */
type Place = { readonly cwd: string; gitEnv(): GitEnv };

/** git, run in one repository under the hardened defaults; `tree` is `cwd` unless it is a cache. */
export class UntrustedGit {
  #ready: Promise<readonly string[]> | undefined;
  #env: GitEnv | undefined;

  constructor(readonly cwd: string, readonly tree: string = cwd) {}

  /** Filtered at the first call and kept: the PATH's every entry is a realpath and a stat. */
  gitEnv(): GitEnv {
    return this.#env ??= untrustedGitEnv((name) => Deno.env.get(name), this.tree);
  }

  /** stdout, or a throw naming why git refused. */
  async run(sub: GitSubcommand, args: readonly string[], input?: Uint8Array): Promise<Uint8Array> {
    const out = await this.call(sub, args, input);
    if (out.code === 0) return out.stdout;
    throw new GitRefused(`git ${sub} failed: ${out.why || `exit ${out.code}`}`);
  }

  /** The exit code and stdout, never a throw for a non-zero exit. */
  async call(sub: GitSubcommand, args: readonly string[], input?: Uint8Array): Promise<GitResult> {
    const lazy = await (this.#ready ??= this.#preflight());
    return spawnGit(this, [...UNTRUSTED_GIT_FLAGS, ...lazy, ...READ_CONFIG, sub, ...args], input);
  }

  /** What every call needs first: no grafts file, and the lazy-fetch flags. */
  async #preflight(): Promise<readonly string[]> {
    await refuseGrafts(this);
    return await this.#lazyFlags();
  }

  /** `--no-lazy-fetch` when git knows it; below 2.44 a promisor remote is refused, not read. */
  async #lazyFlags(): Promise<readonly string[]> {
    if (await (lazySupport ??= knowsLazyFetch(this))) return [LAZY_FETCH_FLAG];
    const args = [...UNTRUSTED_GIT_FLAGS, "config", "--get-regexp", PROMISOR];
    const probe = await spawnGit(this, args);
    if (probe.code === 0) {
      throw new GitRefused(
        "a promisor remote is configured and this git predates --no-lazy-fetch (2.44)",
      );
    }
    return [];
  }
}

/**
 * `GIT_GRAFT_FILE` already keeps git from reading `info/grafts`; a repository that holds one is
 * refused anyway, so a history someone rewrote is named rather than silently read around. Outside
 * a repository nothing is refused here: the call itself says so.
 */
async function refuseGrafts(at: Place): Promise<void> {
  // The common dir, not `--git-path info/grafts`: that one answers with GIT_GRAFT_FILE itself.
  const out = await spawnGit(at, [...UNTRUSTED_GIT_FLAGS, "rev-parse", "--git-common-dir"]);
  if (out.code !== 0) return;
  const common = new TextDecoder().decode(out.stdout).trim();
  try {
    await Deno.lstat(join(isAbsolute(common) ? common : join(at.cwd, common), "info", "grafts"));
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return;
    throw err;
  }
  throw new GitRefused("an info/grafts file rewrites this repository's history: remove it first");
}

/** Names as git stores them, never C-quoted: every caller reads a NUL-separated or raw list. */
const READ_CONFIG = ["-c", "core.quotePath=false"];

async function knowsLazyFetch(at: Place): Promise<boolean> {
  const out = await spawnGit(at, ["version"]);
  const m = /(\d+)\.(\d+)/.exec(new TextDecoder().decode(out.stdout));
  if (out.code !== 0 || m === null) return false;
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return major > LAZY_FETCH_SINCE[0] ||
    (major === LAZY_FETCH_SINCE[0] && minor >= LAZY_FETCH_SINCE[1]);
}

/** git's environment: the allowlist, its PATH kept outside `tree`, the hardened variables. */
export function untrustedGitEnv(
  source: (name: string) => string | undefined,
  tree: string,
): GitEnv {
  const env: Record<string, string> = {};
  for (const name of ENV_ALLOWLIST) {
    const value = source(name);
    if (value !== undefined) env[name] = value;
  }
  const { kept, dropped } = filterGitPath(env.PATH ?? "", tree);
  // Nothing left is refused, never passed on: an empty entry can mean the working folder.
  if (kept === "") {
    throw new GitRefused(gitMissing("no PATH entry outside the repository", dropped));
  }
  return { env: { ...env, PATH: kept, ...UNTRUSTED_GIT_ENV }, dropped };
}

/** The one spawn of git in the binary's reads of an unvetted repository. */
async function spawnGit(at: Place, args: string[], input?: Uint8Array): Promise<GitResult> {
  const child = start(at, args, input !== undefined);
  const fed = input && ReadableStream.from([input]).pipeTo(child.stdin);
  const [out] = await Promise.all([child.output(), fed]);
  const why = new TextDecoder().decode(out.stderr).trim().split("\n")[0].slice(0, 300);
  return { code: out.code, stdout: out.stdout, why };
}

function start(at: Place, args: string[], piped: boolean): Deno.ChildProcess {
  const { env, dropped } = at.gitEnv();
  const command = new Deno.Command("git", {
    args,
    cwd: at.cwd,
    clearEnv: true,
    env,
    stdin: piped ? "piped" : "null",
    stdout: "piped",
    stderr: "piped",
  });
  try {
    return command.spawn();
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
    throw new GitRefused(gitMissing("git is not on the PATH", dropped), { cause: err });
  }
}
