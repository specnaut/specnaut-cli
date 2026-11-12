import { ExportRefused, type TreeObjects } from "../application/untrusted_review_ports.ts";
import { isFullSha } from "../domain/commit_sha.ts";
import { hex, idBytes } from "../domain/git_object_id.ts";
import type { TreeEntry } from "../domain/tree_plan.ts";
import { decode } from "./git_text.ts";
import { UntrustedGit } from "./untrusted_git.ts";

/**
 * A repository's objects read raw through the hardened git: `rev-parse` for the root tree, then
 * `cat-file --batch-check` and `--batch` only. Tree objects are parsed here rather than listed by
 * `ls-tree`, so each name arrives as the bytes git stores, never quoted or decoded, and a whole
 * level of the tree costs one call whatever its width.
 */
export class GitTreeObjects implements TreeObjects {
  readonly #git: UntrustedGit;

  constructor(gitDir: string) {
    this.#git = new UntrustedGit(gitDir);
  }

  async treeOf(commit: string): Promise<string> {
    if (!isFullSha(commit)) throw new ExportRefused("not a full commit id");
    const args = ["--verify", "--quiet", "--end-of-options", `${commit}^{tree}`];
    const tree = decode(await this.#git.run("rev-parse", args)).trim();
    if (!isFullSha(tree)) throw new ExportRefused(`${commit} names no tree`);
    return tree;
  }

  async sizes(ids: readonly string[], type: "tree" | "blob"): Promise<Map<string, number>> {
    const sizes = new Map<string, number>();
    if (ids.length === 0) return sizes;
    const out = decode(await this.#git.run("cat-file", ["--batch-check"], lines(ids)));
    for (const line of out.split("\n").filter(Boolean)) {
      const [id, found, size] = line.split(" ");
      if (found !== type) {
        throw new ExportRefused(`${id} is ${found ?? "unreadable"}, not a ${type}`);
      }
      sizes.set(id, Number(size));
    }
    return sizes;
  }

  async readTrees(ids: readonly string[]): Promise<Map<string, TreeEntry[]>> {
    const trees = new Map<string, TreeEntry[]>();
    for (const [id, bytes] of await this.#batch(ids, "tree")) {
      trees.set(id, parseTree(bytes, idBytes(id)));
    }
    return trees;
  }

  async readBlobs(ids: readonly string[]): Promise<Map<string, Uint8Array>> {
    return await this.#batch(ids, "blob");
  }

  /** Each object's raw bytes through one `cat-file --batch`, its type checked. */
  async #batch(ids: readonly string[], type: string): Promise<Map<string, Uint8Array>> {
    const found = new Map<string, Uint8Array>();
    if (ids.length === 0) return found;
    const out = await this.#git.run("cat-file", ["--batch"], lines(ids));
    let at = 0;
    while (at < out.length) {
      const eol = out.indexOf(0x0a, at);
      const [id, kind, size] = decode(out.subarray(at, eol < 0 ? out.length : eol)).split(" ");
      if (eol < 0 || kind !== type) {
        throw new ExportRefused(`${id} is ${kind ?? "unreadable"}, not a ${type}`);
      }
      const start = eol + 1;
      found.set(id, out.slice(start, start + Number(size)));
      at = start + Number(size) + 1;
    }
    return found;
  }
}

/**
 * A tree object's entries: `<mode> <name>\0<id>`, the id raw, `width` bytes long. A record that
 * does not parse is refused whole rather than skipped, so no entry goes unjudged.
 */
export function parseTree(bytes: Uint8Array, width: number): TreeEntry[] {
  const entries: TreeEntry[] = [];
  let at = 0;
  while (at < bytes.length) {
    const space = bytes.indexOf(0x20, at);
    const nul = space < 0 ? -1 : bytes.indexOf(0x00, space + 1);
    if (nul < 0 || nul + 1 + width > bytes.length) {
      throw new ExportRefused("a tree object does not parse");
    }
    entries.push({
      mode: decode(bytes.subarray(at, space)),
      name: bytes.slice(space + 1, nul),
      sha: hex(bytes.subarray(nul + 1, nul + 1 + width)),
    });
    at = nul + 1 + width;
  }
  return entries;
}

const lines = (ids: readonly string[]) =>
  new TextEncoder().encode(ids.map((i) => `${i}\n`).join(""));
