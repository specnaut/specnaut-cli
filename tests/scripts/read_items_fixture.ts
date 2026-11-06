import { assert, assertEquals, assertMatch } from "@std/assert";
import { join } from "@std/path";
import { type Backend, type Project, project } from "./backlog_tracker_fixture.ts";

/**
 * `read-items.sh` writes the items the product owner works on to one file and
 * prints three lines. This reads that output back the way a reader of the file
 * would: the header, the lines outside every block, and each block whose
 * opening tag, one JSON line and matching closing tag hold together.
 */

/** Every character `_issue_text.sh` keeps out of a block, besides \n and \t. */
export const NOT_INERT =
  // deno-lint-ignore no-control-regex
  /[\x00-\x08\x0b-\x1f\x7f-\x9f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u{e0000}-\u{e007f}]/u;

const OPEN =
  /^<untrusted-issue-text nonce="([0-9a-f]{32})" item="(\d+)" field="(\w+)" author="([^"]*)" association="([A-Z_]+)" by_viewer="(true|false|unknown)"( truncated="true")?>$/;

export interface Block {
  item: string;
  field: string;
  author: string;
  association: string;
  byViewer: string;
  truncated: boolean;
  value: string;
}

export interface Read {
  path: string;
  items: string;
  fingerprint: string;
  text: string;
  header: Record<string, string>;
  /** Every line outside a block, the header's included. */
  outside: string[];
  blocks: Block[];
  nonce: string;
}

/** Parses a block-structured items file; any tag that does not close is a failure. */
export function parse(text: string): Omit<Read, "path" | "items" | "fingerprint"> {
  const lines = text.split("\n");
  const outside: string[] = [];
  const blocks: Block[] = [];
  const header: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(OPEN);
    if (!m) {
      outside.push(lines[i]);
      const kv = lines[i].match(/^([a-z_-]+): (.*)$/);
      if (kv && blocks.length === 0 && !(kv[1] in header)) header[kv[1]] = kv[2];
      continue;
    }
    assertEquals(lines[i + 2], `</untrusted-issue-text nonce="${m[1]}">`, `block at line ${i + 1}`);
    assertEquals(m[1], header.nonce, "a block under another nonce");
    const [, , item, field, author, association, byViewer, cut] = m;
    blocks.push({
      item,
      field,
      author,
      association,
      byViewer,
      truncated: cut !== undefined,
      value: JSON.parse(lines[i + 1]),
    });
    i += 2;
  }
  return { text, header, outside, blocks, nonce: header.nonce };
}

/** Runs read-items.sh; on success asserts stdout is exactly its three lines, and reads the file. */
export async function readItems(p: Project, args: string[], env?: Record<string, string>) {
  const r = await p.run("read-items.sh", args, env);
  if (r.code !== 0) return { r, read: undefined };
  assertMatch(r.stdout, /^ITEMS_FILE: [^\n]+\nITEMS: [^\n]+\nFINGERPRINT: [0-9a-f]{40}\n$/);
  const [path, items, fingerprint] = r.stdout.trimEnd().split("\n").map((l) =>
    l.slice(l.indexOf(": ") + 2)
  );
  const read: Read = { path, items, fingerprint, ...parse(await Deno.readTextFile(path)) };
  assertEquals(read.header.fingerprint, fingerprint);
  assertEquals(read.header.items, items);
  return { r, read };
}

/** A project for `backend` inside a git work tree, as `read-items.sh` requires. */
export async function gitProject(backend: Backend): Promise<Project> {
  const p = await project(backend);
  const git = await new Deno.Command("git", { args: ["init", "-q", p.dir] }).output();
  assert(git.success, "git init failed");
  return p;
}

/** Removes the directory an items file sits in. */
export async function removeRead(read: Read | undefined) {
  if (read) await Deno.remove(join(read.path, ".."), { recursive: true });
}
