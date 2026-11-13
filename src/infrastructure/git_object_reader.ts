import type { BaseFile, GitObjectReader } from "../application/script_trust_ports.ts";
import { inScopeRoot, type ScopeRoot } from "../domain/checkout_scope.ts";
import { isFullSha } from "../domain/commit_sha.ts";
import type { BaseEntry, CommitEntry } from "../domain/script_trust.ts";
import { catFiles, lsTree, withBytes } from "./git_tree_records.ts";
import { decode, firstLine } from "./git_text.ts";
import { PLAIN_DIFF_FLAGS, UntrustedGit } from "./untrusted_git.ts";

/**
 * Reads a repository's commits for the script and checkout checks, through the hardened git. Every
 * object is read raw (`ls-tree`, `cat-file --batch`), never through a filter or a textconv, and
 * nothing here touches the work tree: no `status`, no hashing of a file on disk, no diff against
 * it. A test greps this module for those subcommands.
 */

export class GitObjects implements GitObjectReader {
  readonly #git: UntrustedGit;

  /** `prefix` is the project's folder under git's top level: `""`, or `sub/dir/`. */
  private constructor(cwd: string, readonly projectPrefix: string) {
    this.#git = new UntrustedGit(cwd);
  }

  static async open(cwd: string): Promise<GitObjects> {
    const out = await new UntrustedGit(cwd).run("rev-parse", ["--show-prefix"]);
    return new GitObjects(cwd, firstLine(out));
  }

  async originHead(): Promise<string | null> {
    const out = await this.#git.call("symbolic-ref", ["--quiet", "refs/remotes/origin/HEAD"]);
    return out.code === 0 ? firstLine(out.stdout) : null;
  }

  async globalDefaultBranch(): Promise<string | null> {
    const args = ["--global", "--no-includes", "--get", "init.defaultBranch"];
    const out = await this.#git.call("config", args);
    return out.code === 0 && firstLine(out.stdout) !== "" ? firstLine(out.stdout) : null;
  }

  async hasOrigin(): Promise<boolean> {
    return (await this.#git.call("config", ["--get", "remote.origin.url"])).code === 0;
  }

  /**
   * Repository and global configuration only, no system file. Unset, or not a boolean git reads,
   * is git's default: links are written as links.
   */
  async symlinks(): Promise<boolean> {
    const out = await this.#git.call("config", ["--bool", "--get", "core.symlinks"]);
    return !(out.code === 0 && firstLine(out.stdout) === "false");
  }

  async commitOf(ref: string): Promise<string | null> {
    const out = await this.#git.call("rev-parse", ["--verify", "--quiet", `${ref}^{commit}`]);
    const sha = firstLine(out.stdout);
    return out.code === 0 && isFullSha(sha) ? sha : null;
  }

  async mergeBase(a: string, b: string): Promise<string | null> {
    const out = await this.#git.call("merge-base", [a, b]);
    const sha = firstLine(out.stdout);
    return out.code === 0 && isFullSha(sha) ? sha : null;
  }

  async aheadCount(from: string, to: string): Promise<number> {
    return Number(firstLine(await this.#git.run("rev-list", ["--count", `${from}..${to}`])));
  }

  async commitsAhead(from: string, to: string): Promise<string[]> {
    const out = decode(await this.#git.run("rev-list", [`${from}..${to}`]));
    return out.split("\n").filter(isFullSha);
  }

  async listTree(commit: string, dir: string): Promise<BaseEntry[]> {
    const records = await lsTree(this.#git, this.projectPrefix, commit, [
      "-r",
      "--",
      `${this.projectPrefix}${dir}`,
    ]);
    return await withBytes(this.#git, commit, records);
  }

  /**
   * A deep root is listed as `listTree` lists it, the root's own entry included (a link or a
   * submodule there); a shallow one without `-r`. Filtered before any blob is read.
   */
  async listRoot(commit: string, root: ScopeRoot): Promise<BaseEntry[]> {
    const dir = root.dir === "." ? "" : root.deep ? root.dir : `${root.dir}/`;
    const path = `${this.projectPrefix}${dir}`;
    const args = [...(root.deep ? ["-r"] : []), ...(path === "" ? [] : ["--", path])];
    const records = await lsTree(this.#git, this.projectPrefix, commit, args);
    return await withBytes(this.#git, commit, records.filter((r) => inScopeRoot(root, r.path)));
  }

  async listCommit(commit: string, keep: (path: string) => boolean): Promise<CommitEntry[]> {
    const records = await lsTree(this.#git, this.projectPrefix, commit, ["-r", "-t"], true);
    const kept = records.filter((r) => keep(r.path));
    const folders = kept.flatMap((r): CommitEntry[] => r.kind === "tree" ? [r] : []);
    return [...folders, ...await withBytes(this.#git, commit, kept)];
  }

  async readFile(commit: string, path: string): Promise<BaseFile> {
    const [record] = await lsTree(this.#git, this.projectPrefix, commit, [
      "--",
      `${this.projectPrefix}${path}`,
    ]);
    if (record === undefined || record.path !== path) return { kind: "absent" };
    if (record.kind !== "blob") return { kind: "not_regular" };
    return { kind: "blob", bytes: (await catFiles(this.#git, commit, [record])).get(record.sha)! };
  }

  async changedNames(from: string, to: string): Promise<string[]> {
    const args = ["-r", "-z", "--name-only", ...PLAIN_DIFF_FLAGS, from, to];
    return decode(await this.#git.run("diff-tree", args)).split("\0").filter(Boolean);
  }
}
