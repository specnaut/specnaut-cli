import { foldKey, instructionPath, nameFault, repositoryShaped } from "./tree_names.ts";

/**
 * What of a fetched tree is written as files, and what is only listed. Every entry passes the name
 * rules and the caps here, while the tree is read one level at a time, so the plan is complete and
 * judged before the first byte reaches the disk: a refused tree writes nothing at all.
 */

/** One entry of a tree object, its name as the raw bytes git stores. */
export type TreeEntry = { readonly mode: string; readonly name: Uint8Array; readonly sha: string };

/** A tree still to read: its object id and its path as names from the root. */
export type TreeToRead = { readonly names: readonly string[]; readonly sha: string };

export type PlannedFile = {
  readonly path: string;
  readonly names: readonly string[];
  readonly sha: string;
  readonly executable: boolean;
};

/** An entry that is never materialised, with the object id a reader can still fetch it by. */
export type ListedEntry = { readonly path: string; readonly sha: string; readonly kind: string };

export type ExportPlan = {
  readonly files: readonly PlannedFile[];
  readonly listed: readonly ListedEntry[];
};

/** Bounds on what one export may hold, so a crafted tree cannot exhaust the disk or the memory. */
export type TreeCaps = {
  readonly entries: number;
  readonly bytes: number;
  readonly depth: number;
  readonly pathBytes: number;
};

export const DEFAULT_TREE_CAPS: TreeCaps = {
  entries: 100_000,
  bytes: 256 * 2 ** 20,
  depth: 32,
  pathBytes: 1024,
};

/** The tree may not be exported; every fault found, or the one cap that stopped the reading. */
export class TreeRefused extends Error {
  constructor(readonly faults: readonly string[]) {
    super(`the tree is refused:\n${faults.map((f) => `  - ${f}`).join("\n")}`);
  }
}

const TREE = "40000";
const BLOB_MODES: Readonly<Record<string, boolean>> = { "100644": false, "100755": true };
const LISTED_MODES: Readonly<Record<string, string>> = { "120000": "link", "160000": "submodule" };

export class TreePlanner {
  readonly #files: PlannedFile[] = [];
  readonly #listed: ListedEntry[] = [];
  readonly #faults: string[] = [];
  #entries = 0;
  #bytes = 0;

  constructor(readonly caps: TreeCaps, readonly windows: boolean) {}

  /**
   * Judges one tree's entries; returns the subtrees to read next. Throws at a cap. A folder laid
   * out as a repository, the root included, is listed whole and nothing in it is written.
   */
  admit(dir: TreeToRead, entries: readonly TreeEntry[]): TreeToRead[] {
    if (repositoryShaped(entries.map((e) => shown(e.name)))) {
      this.#listed.push({ path: dir.names.join("/") || ".", sha: dir.sha, kind: "repository" });
      return [];
    }
    const seen = new Set<string>();
    return entries.flatMap((e) => this.#admitOne(dir, e, seen));
  }

  /** Counts object bytes about to be read against the byte cap. */
  charge(bytes: number): void {
    this.#bytes += bytes;
    if (this.#bytes > this.caps.bytes) {
      throw new TreeRefused([`the tree holds more than ${this.caps.bytes} bytes`]);
    }
  }

  finish(): ExportPlan {
    if (this.#faults.length > 0) throw new TreeRefused(this.#faults);
    return { files: this.#files, listed: this.#listed };
  }

  /** One entry: counted and depth-checked first, then judged by name, then placed. */
  #admitOne(dir: TreeToRead, e: TreeEntry, seen: Set<string>): TreeToRead[] {
    if (++this.#entries > this.caps.entries) {
      throw new TreeRefused([`the tree holds more than ${this.caps.entries} entries`]);
    }
    const names = [...dir.names, shown(e.name)];
    const path = names.join("/");
    if (names.length > this.caps.depth) {
      throw new TreeRefused([`${path}: deeper than ${this.caps.depth} folders`]);
    }
    const fault = this.#fault(e.name, path, seen);
    if (fault !== null) this.#faults.push(`${path}: ${fault}`);
    else if (e.mode === TREE) return [{ names, sha: e.sha }];
    else this.#place(e, names, path);
    return [];
  }

  #fault(bytes: Uint8Array, path: string, seen: Set<string>): string | null {
    const fault = nameFault(bytes, this.windows);
    if (fault !== null) return fault;
    if (new TextEncoder().encode(path).length > this.caps.pathBytes) {
      return `a path over ${this.caps.pathBytes} bytes`;
    }
    const key = foldKey(shown(bytes));
    if (seen.has(key)) {
      return "a twin of another name in its folder on a case- or form-insensitive filesystem";
    }
    seen.add(key);
    return null;
  }

  #place(e: TreeEntry, names: readonly string[], path: string): void {
    const listedAs = LISTED_MODES[e.mode];
    const executable = BLOB_MODES[e.mode];
    if (listedAs !== undefined) this.#listed.push({ path, sha: e.sha, kind: listedAs });
    else if (executable === undefined) {
      this.#listed.push({ path, sha: e.sha, kind: `unsupported mode ${e.mode}` });
    } else if (instructionPath(names)) this.#listed.push({ path, sha: e.sha, kind: "instruction" });
    else this.#files.push({ path, names, sha: e.sha, executable });
  }
}

/**
 * A name as text fit for a message and a fold: a bad sequence becomes U+FFFD, and so does a
 * control character, so a refusal can be printed without the name steering the terminal.
 */
function shown(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)
    // deno-lint-ignore no-control-regex -- replacing every control character is the point
    .replace(/[\x00-\x1f\x7f-\x9f]/g, "\ufffd");
}
