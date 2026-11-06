import type { BaseFile, GitObjectReader } from "../application/script_trust_ports.ts";
import type { BaseEntry } from "../domain/script_trust.ts";
import { PLAIN_DIFF_FLAGS, UntrustedGit } from "./untrusted_git.ts";

/**
 * Reads a repository's commits for `specnaut verify-scripts`, through the hardened git. Every
 * object is read raw (`ls-tree`, `cat-file --batch`), never through a filter or a textconv, and
 * nothing here touches the work tree: no `status`, no hashing of a file on disk, no diff against
 * it. A test greps this module for those subcommands.
 */

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
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
    return out.code === 0 && SHA.test(sha) ? sha : null;
  }

  async mergeBase(a: string, b: string): Promise<string | null> {
    const out = await this.#git.call("merge-base", [a, b]);
    const sha = firstLine(out.stdout);
    return out.code === 0 && SHA.test(sha) ? sha : null;
  }

  async aheadCount(from: string, to: string): Promise<number> {
    return Number(firstLine(await this.#git.run("rev-list", ["--count", `${from}..${to}`])));
  }

  async listTree(commit: string, dir: string): Promise<BaseEntry[]> {
    const records = await this.#lsTree(commit, ["-r", "--", `${this.projectPrefix}${dir}`]);
    const blobs = records.filter((r) => r.kind === "blob");
    const bytes = await this.#catFiles(blobs.map((r) => r.sha));
    return records.map((r): BaseEntry =>
      r.kind === "blob" ? { kind: "blob", path: r.path, bytes: bytes.get(r.sha)! } : r
    );
  }

  async readFile(commit: string, path: string): Promise<BaseFile> {
    const [record] = await this.#lsTree(commit, ["--", `${this.projectPrefix}${path}`]);
    if (record === undefined || record.path !== path) return { kind: "absent" };
    if (record.kind !== "blob") return { kind: "not_regular" };
    return { kind: "blob", bytes: (await this.#catFiles([record.sha])).get(record.sha)! };
  }

  async changedNames(from: string, to: string): Promise<string[]> {
    const args = ["-r", "-z", "--name-only", "--no-renames", ...PLAIN_DIFF_FLAGS, from, to];
    return decode(await this.#git.run("diff-tree", args)).split("\0").filter(Boolean);
  }

  /** `ls-tree -z --full-tree`, paths made project-relative; a tree entry is not listed. */
  async #lsTree(commit: string, args: string[]): Promise<TreeRecord[]> {
    const out = decode(await this.#git.run("ls-tree", ["-z", "--full-tree", commit, ...args]));
    const records: TreeRecord[] = [];
    for (const line of out.split("\0")) {
      const m = /^(\d+) (\w+) ([0-9a-f]+)\t(.*)$/s.exec(line);
      if (m === null || !m[4].startsWith(this.projectPrefix)) continue;
      const path = m[4].slice(this.projectPrefix.length);
      if (m[1] === "160000") records.push({ kind: "submodule", path });
      else if (m[1] === "120000") records.push({ kind: "link", path });
      else if (m[2] === "blob") records.push({ kind: "blob", path, sha: m[3] });
    }
    return records;
  }

  /** Each object's raw bytes, through one `cat-file --batch`. */
  async #catFiles(shas: string[]): Promise<Map<string, Uint8Array>> {
    const found = new Map<string, Uint8Array>();
    if (shas.length === 0) return found;
    const input = new TextEncoder().encode(shas.map((s) => `${s}\n`).join(""));
    const out = await this.#git.run("cat-file", ["--batch"], input);
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
}

type TreeRecord =
  | { kind: "blob"; path: string; sha: string }
  | { kind: "link"; path: string }
  | { kind: "submodule"; path: string };
