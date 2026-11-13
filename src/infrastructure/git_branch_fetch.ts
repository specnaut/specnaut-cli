import { join } from "@std/path";
import { type BranchFetcher, ExportRefused } from "../application/untrusted_review_ports.ts";
import { type BranchSource, FETCHED_REF, refspecOf } from "../domain/branch_source.ts";
import { decode, firstLine } from "./git_text.ts";
import { GitRefused, UNTRUSTED_GIT_FLAGS, UntrustedGit, untrustedGitEnv } from "./untrusted_git.ts";

/**
 * Fetches one branch as objects into a bare repository made for it, never into the user's own.
 * It lives beside `UntrustedGit`, not in it, because a fetch runs programs by design (the
 * transport, a credential helper) where every `UntrustedGit` subcommand runs none; what it shares
 * is the flag list that turns off each program the repository's configuration could name.
 *
 * The new repository borrows the user's objects through `objects/info/alternates`, so only what
 * the branch adds crosses the network, and only what crosses it is checked by fsck: an object
 * borrowed through `alternates` never is. So the tree planner (`tree_plan.ts`) is the gate that
 * refuses a name such as `..` or `.git` and lists an odd mode unwritten, whichever side the tree
 * came from; fsck is only the earlier check on what is received. The repository has no template, so no hook; it
 * fetches no tag, no submodule and no bundle a server advertises; the remote's URL is read from
 * the user's own configuration and only after `--`, with the transports pinned to an allowlist.
 */

/**
 * The fsck checks a received tree must pass, each pinned to `error` on the command line, which no
 * configuration file outranks: a name that is `.`, `..`, `.git`, empty or a path, and a mode git
 * would not write. git leaves them at a warning (one at `info`), which a `fetch.fsck.<id>` setting
 * in the user's configuration could lower to `ignore`.
 */
// deno-fmt-ignore
export const PINNED_FSCK_CHECKS: readonly string[] = [
  "hasDot", "hasDotdot", "hasDotgit", "fullPathname", "emptyName", "badFilemode",
  "zeroPaddedFilemode",
];

/** The transports a fetch may use: authenticated ones only, never `file`, `git` or `ext`. */
export const DEFAULT_PROTOCOLS: readonly string[] = ["https", "ssh"];

/**
 * Transports pinned to `never` one by one before the allowlist: a `protocol.<name>.allow=always`
 * in the user's configuration outranks `protocol.allow=never`, and only a command-line setting
 * outranks it. One the allowlist names is allowed again after them, the later setting winning.
 */
export const REFUSED_PROTOCOLS: readonly string[] = ["file", "ext", "git", "http"];

export const FETCH_TIMEOUT_MS = 120_000;

export type FetchOptions = {
  readonly protocols?: readonly string[];
  readonly timeoutMs?: number;
  /** Where the fetch reads the caller's variables from; the process's own by default. */
  readonly env?: (name: string) => string | undefined;
};

/** The fetch's whole command line, its options before `--` and the URL and refspec after. */
export function fetchArgs(url: string, refspec: string, protocols: readonly string[]): string[] {
  // deno-fmt-ignore
  return [
    ...UNTRUSTED_GIT_FLAGS,
    "-c", "protocol.allow=never",
    ...REFUSED_PROTOCOLS.flatMap((p) => ["-c", `protocol.${p}.allow=never`]),
    ...protocols.flatMap((p) => ["-c", `protocol.${p}.allow=always`]),
    "-c", "protocol.version=2",
    "-c", "transfer.fsckObjects=true", "-c", "fetch.fsckObjects=true",
    ...PINNED_FSCK_CHECKS.flatMap((id) => ["-c", `fetch.fsck.${id}=error`]),
    "-c", "transfer.bundleURI=false", "-c", "fetch.bundleURI=",
    "-c", "fetch.recurseSubmodules=false", "-c", "fetch.writeCommitGraph=false",
    "fetch", "--quiet", "--no-tags", "--no-recurse-submodules", "--no-write-fetch-head",
    "--no-auto-gc", "--", url, `${refspec}:${FETCHED_REF}`,
  ];
}

export class GitBranchFetcher implements BranchFetcher {
  readonly #project: UntrustedGit;
  readonly #protocols: readonly string[];
  readonly #timeoutMs: number;
  readonly #env: (name: string) => string | undefined;

  constructor(readonly projectDir: string, options: FetchOptions = {}) {
    this.#project = new UntrustedGit(projectDir);
    this.#protocols = options.protocols ?? DEFAULT_PROTOCOLS;
    this.#timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
    this.#env = options.env ?? ((name) => Deno.env.get(name));
  }

  async remotes(): Promise<string[]> {
    const args = ["--name-only", "--get-regexp", "^remote\\..*\\.url$"];
    const out = await this.#project.call("config", args).catch(asRefusal);
    if (out.code === 1) return [];
    if (out.code !== 0) throw new ExportRefused(`git config failed: ${out.why}`);
    // A key is `remote.<name>.url`, and `<name>` may itself hold dots, spaces or slashes.
    return decode(out.stdout).split("\n").filter(Boolean)
      .map((key) => key.slice("remote.".length, -".url".length));
  }

  async fetch(source: BranchSource, gitDir: string): Promise<string> {
    const url = await this.#read("config", ["--get", `remote.${source.remote}.url`]);
    const common = await this.#read("rev-parse", ["--path-format=absolute", "--git-common-dir"]);
    const format = await this.#read("rev-parse", ["--show-object-format"]);
    await this.#git("init", this.projectDir, initArgs(format, gitDir));
    const alternates = join(gitDir, "objects", "info", "alternates");
    await Deno.writeTextFile(alternates, `${join(common, "objects")}\n`);
    await this.#git("fetch", gitDir, fetchArgs(url, refspecOf(source), this.#protocols));
    const head = await new UntrustedGit(gitDir)
      .run("rev-parse", ["--verify", "--quiet", "--end-of-options", `${FETCHED_REF}^{commit}`])
      .catch(asRefusal);
    return firstLine(head);
  }

  async #read(sub: "config" | "rev-parse", args: string[]): Promise<string> {
    return firstLine(await this.#project.run(sub, args).catch(asRefusal));
  }

  /** git with the fetch's environment and timeout; a failure is refused with git's cause. */
  async #git(what: string, cwd: string, args: string[]): Promise<void> {
    const signal = AbortSignal.timeout(this.#timeoutMs);
    const out = await spawn(cwd, args, fetchEnv(this.#env), signal);
    if (signal.aborted) {
      throw new ExportRefused(`the fetch did not finish within ${this.#timeoutMs / 1000} s`);
    }
    if (out.code !== 0) throw new ExportRefused(`git ${what} failed: ${causeOf(out.stderr)}`);
  }
}

/** No input, and only stderr kept: it carries git's cause when the step fails. */
const QUIET = { stdin: "null", stdout: "null", stderr: "piped" } as const;

/** One git process; a spawn that finds no git program is a refusal the user can act on. */
async function spawn(
  cwd: string,
  args: string[],
  env: Record<string, string>,
  signal: AbortSignal,
): Promise<Deno.CommandOutput> {
  const command = new Deno.Command("git", { ...QUIET, args, cwd, clearEnv: true, env, signal });
  try {
    return await command.output();
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
    throw new ExportRefused("git is not on the PATH", { cause: err });
  }
}

/** git's refusal, said in the export's own terms; anything else is not a refusal and goes on. */
function asRefusal(err: unknown): never {
  if (err instanceof GitRefused) throw new ExportRefused(err.message, { cause: err });
  throw err;
}

/** A bare repository with no template, so no hook, in the object format of the user's own. */
function initArgs(format: string, gitDir: string): string[] {
  const init = ["init", "--bare", "--quiet", "--template=", `--object-format=${format}`];
  return [...UNTRUSTED_GIT_FLAGS, ...init, "--", gitDir];
}

/**
 * The hardened environment, plus the SSH agent an ssh remote authenticates through, and a fixed
 * locale so git's refusals read the same everywhere.
 */
function fetchEnv(source: (name: string) => string | undefined): Record<string, string> {
  const env = untrustedGitEnv(source);
  const agent = source("SSH_AUTH_SOCK");
  if (agent !== undefined) env.SSH_AUTH_SOCK = agent;
  return { ...env, LC_ALL: "C", LANG: "C", GIT_PROTOCOL_FROM_USER: "0" };
}

/** git states the cause before the step that failed (fsck, then index-pack): keep each. */
function causeOf(stderr: Uint8Array): string {
  const said = decode(stderr).trim().split("\n");
  const causes = said.filter((l) => /^(fatal|error):/.test(l)).join("; ");
  return redacted((causes || said.at(-1) || "").slice(0, 300));
}

/** A URL's `user:secret@` replaced, in case git echoes the remote it was given. */
export const redacted = (text: string) => text.replace(/\/\/[^/@\s]+@/g, "//***@");
