import {
  type BaseFile,
  type GitObjectReader,
  MAX_SCRIPT_BYTES,
} from "../application/script_trust_ports.ts";
import { inScopeRoot, type ScopeRoot } from "../domain/checkout_scope.ts";
import { isFullSha } from "../domain/commit_sha.ts";
import type { BaseEntry } from "../domain/script_trust.ts";
import { GitRefused, PLAIN_DIFF_FLAGS, UntrustedGit } from "./untrusted_git.ts";

/**
 * Reads a repository's commits for the script and checkout checks, through the hardened git. Every
 * object is read raw (`ls-tree`, `cat-file --batch`), never through a filter or a textconv, and
 * nothing here touches the work tree: no `status`, no hashing of a file on disk, no diff against
 * it. A test greps this module for those subcommands.
 */

const decode = (b: Uint8Array) => new TextDecoder().decode(b);
const firstLine = (b: Uint8Array) => decode(b).split("\n")[0];

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
    const args = ["-r", "-z", "--name-only", "--no-renames", ...PLAIN_DIFF_FLAGS, from, to];
    return decode(await this.#git.run("diff-tree", args)).split("\0").filter(Boolean);
  }
}

/** A blob `ls-tree -l` listed: a file's, or a link's, whose bytes are its target. */
type BlobRecord = { kind: "blob" | "link"; path: string; sha: string; size: number };
type TreeRecord = BlobRecord | { kind: "submodule"; path: string };

/** `ls-tree -z -l --full-tree`, paths made relative to `prefix`; a tree entry is not listed. */
async function lsTree(
  git: UntrustedGit,
  prefix: string,
  commit: string,
  args: string[],
): Promise<TreeRecord[]> {
  const argv = ["-z", "-l", "--full-tree", commit, ...args];
  const records: TreeRecord[] = [];
  for (const line of decode(await git.run("ls-tree", argv)).split("\0")) {
    const m = /^(\d+) (\w+) ([0-9a-f]+) +(-|\d+)\t(.*)$/s.exec(line);
    if (m === null || !m[5].startsWith(prefix)) continue;
    const path = m[5].slice(prefix.length);
    const blob = { path, sha: m[3], size: Number(m[4]) };
    if (m[1] === "160000") records.push({ kind: "submodule", path });
    else if (m[1] === "120000") records.push({ kind: "link", ...blob });
    else if (m[2] === "blob") records.push({ kind: "blob", ...blob });
  }
  return records;
}

/** Each record with its blob's bytes, a link with its target. */
async function withBytes(
  git: UntrustedGit,
  commit: string,
  records: TreeRecord[],
): Promise<BaseEntry[]> {
  const bytes = await catFiles(git, commit, records.filter((r) => r.kind !== "submodule"));
  return records.map((r): BaseEntry => {
    if (r.kind === "submodule") return r;
    if (r.kind === "link") return { kind: "link", path: r.path, target: decode(bytes.get(r.sha)!) };
    return { kind: "blob", path: r.path, bytes: bytes.get(r.sha)! };
  });
}

/**
 * Each blob's raw bytes, a link's included, through one `cat-file --batch`. The sizes `ls-tree`
 * listed are checked first: a blob over the cap is refused by its path, before any of it is read.
 */
async function catFiles(
  git: UntrustedGit,
  commit: string,
  blobs: BlobRecord[],
): Promise<Map<string, Uint8Array>> {
  const found = new Map<string, Uint8Array>();
  const over = blobs.find((b) => b.size > MAX_SCRIPT_BYTES);
  if (over) throw new GitRefused(`${over.path} at ${commit} is over ${MAX_SCRIPT_BYTES} bytes`);
  if (blobs.length === 0) return found;
  const input = new TextEncoder().encode(blobs.map((b) => `${b.sha}\n`).join(""));
  const out = await git.run("cat-file", ["--batch"], input);
  let at = 0;
  while (at < out.length) {
    const eol = out.indexOf(0x0a, at);
    const [sha, type, size] = decode(out.subarray(at, eol)).split(" ");
    if (type !== "blob") throw new Error(`git cat-file: ${sha} is ${type ?? "missing"}`);
    const start = eol + 1;
    found.set(sha, out.slice(start, start + Number(size)));
    at = start + Number(size) + 1;
  }
  return found;
}
