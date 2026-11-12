import { join } from "@std/path";
import { type BranchFetcher, ExportRefused } from "../application/untrusted_review_ports.ts";
import { type BranchSource, FETCHED_REF, refspecOf } from "../domain/branch_source.ts";
import { GitRefused, UNTRUSTED_GIT_FLAGS, UntrustedGit, untrustedGitEnv } from "./untrusted_git.ts";

/**
 * Fetches one branch as objects into a bare repository made for it, never into the user's own.
 * It lives beside `UntrustedGit`, not in it, because a fetch runs programs by design (the
 * transport, a credential helper) where every `UntrustedGit` subcommand runs none; what it shares
 * is the flag list that turns off each program the repository's configuration could name.
 *
 * The new repository borrows the user's objects through `objects/info/alternates`, so only what
 * the branch adds crosses the network, and its received objects are checked by fsck. It has no
 * template, so no hook; it fetches no tag and no submodule; the remote's URL is read from the
 * user's own configuration and only after `--`, with the transports pinned to an allowlist.
 */

/** The transports a fetch may use: authenticated ones only, never `file`, `git` or `ext`. */
export const DEFAULT_PROTOCOLS: readonly string[] = ["https", "ssh"];

export const FETCH_TIMEOUT_MS = 120_000;

export type FetchOptions = { readonly protocols?: readonly string[]; readonly timeoutMs?: number };

/** The fetch's whole command line, its options before `--` and the URL and refspec after. */
export function fetchArgs(url: string, refspec: string, protocols: readonly string[]): string[] {
  // deno-fmt-ignore
  return [
    ...UNTRUSTED_GIT_FLAGS,
    "-c", "protocol.allow=never",
    ...protocols.flatMap((p) => ["-c", `protocol.${p}.allow=always`]),
    "-c", "protocol.version=2",
    "-c", "transfer.fsckObjects=true", "-c", "fetch.fsckObjects=true",
    "-c", "fetch.recurseSubmodules=false", "-c", "fetch.writeCommitGraph=false",
    "fetch", "--quiet", "--no-tags", "--no-recurse-submodules", "--no-write-fetch-head",
    "--no-auto-gc", "--", url, `${refspec}:${FETCHED_REF}`,
  ];
}

export class GitBranchFetcher implements BranchFetcher {
  readonly #project: UntrustedGit;
  readonly #protocols: readonly string[];
  readonly #timeoutMs: number;

  constructor(readonly projectDir: string, options: FetchOptions = {}) {
    this.#project = new UntrustedGit(projectDir);
    this.#protocols = options.protocols ?? DEFAULT_PROTOCOLS;
    this.#timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  }

  async remotes(): Promise<string[]> {
    const args = ["--name-only", "--get-regexp", "^remote\\..*\\.url$"];
    const out = await this.#project.call("config", args);
    if (out.code === 1) return [];
    if (out.code !== 0) throw new GitRefused(`git config failed: ${out.why}`);
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
      .run("rev-parse", ["--verify", "--quiet", "--end-of-options", `${FETCHED_REF}^{commit}`]);
    return firstLine(head);
  }

  async #read(sub: "config" | "rev-parse", args: string[]): Promise<string> {
    return firstLine(await this.#project.run(sub, args));
  }

  /** git with the fetch's environment and timeout; a failure is refused with git's cause. */
  async #git(what: string, cwd: string, args: string[]): Promise<void> {
    const signal = AbortSignal.timeout(this.#timeoutMs);
    const out = await new Deno.Command("git", {
      args,
      cwd,
      clearEnv: true,
      env: fetchEnv((name) => Deno.env.get(name)),
      stdin: "null",
      stdout: "null",
      stderr: "piped",
      signal,
    }).output();
    if (signal.aborted) {
      throw new ExportRefused(`the fetch did not finish within ${this.#timeoutMs / 1000} s`);
    }
    if (out.code !== 0) throw new ExportRefused(`git ${what} failed: ${causeOf(out.stderr)}`);
  }
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

const decode = (b: Uint8Array) => new TextDecoder().decode(b);
const firstLine = (b: Uint8Array) => decode(b).split("\n")[0];

/** A URL's `user:secret@` replaced, in case git echoes the remote it was given. */
export const redacted = (text: string) => text.replace(/\/\/[^/@\s]+@/g, "//***@");
