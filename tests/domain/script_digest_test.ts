import { assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import { headDigest, type HeadEntry, scriptsDigest } from "../../src/domain/script_digest.ts";
import type { TreeEntry } from "../../src/domain/script_trust.ts";
import { projectRelative } from "../../src/domain/project_names.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const file = (path: string, text: string): TreeEntry => ({
  kind: "file",
  path,
  bytes: enc(text),
  links: 1,
});
const digest = (entries: TreeEntry[]) => scriptsDigest({ kind: "walked", entries });

Deno.test("the digest is a sha256 that does not depend on the walk's order", async () => {
  const a = file("s/a.sh", "a"), b = file("s/b.sh", "b");
  assertMatch(await digest([a, b]), /^[0-9a-f]{64}$/);
  assertEquals(await digest([a, b]), await digest([b, a]));
});

Deno.test("the digest changes with any byte, and with bytes moved from one file to another", async () => {
  const base = await digest([file("s/a.sh", "ab"), file("s/b.sh", "c")]);
  assertNotEquals(base, await digest([file("s/a.sh", "ab"), file("s/b.sh", "d")]));
  assertNotEquals(base, await digest([file("s/a.sh", "a"), file("s/b.sh", "bc")]));
  assertNotEquals(base, await digest([file("s/a.sh", "ab"), { kind: "link", path: "s/b.sh" }]));
});

Deno.test("a walk stopped at a link has a digest of its own", async () => {
  const blocked = await scriptsDigest({ kind: "blocked", path: ".specnaut", why: "a link" });
  assertNotEquals(blocked, await digest([]));
});

const blob = (path: string, text: string): HeadEntry => ({ kind: "blob", path, bytes: enc(text) });

Deno.test("HEAD's digest follows the bytes that land, not the paths named", async () => {
  const base = await headDigest([blob("AGENTS.md", "a"), blob("CLAUDE.md", "b")]);
  assertMatch(base, /^[0-9a-f]{64}$/);
  assertEquals(base, await headDigest([blob("CLAUDE.md", "b"), blob("AGENTS.md", "a")]));
  assertNotEquals(base, await headDigest([blob("AGENTS.md", "a2"), blob("CLAUDE.md", "b")]));
  assertNotEquals(base, await headDigest([blob("AGENTS.md", "ab"), blob("CLAUDE.md", "")]));
});

Deno.test("HEAD's digest tells a link from a file of its target, and a path that is not a file", async () => {
  const link: HeadEntry = { kind: "link", path: "CLAUDE.md", target: "AGENTS.md" };
  const asFile = await headDigest([blob("CLAUDE.md", "AGENTS.md")]);
  assertNotEquals(asFile, await headDigest([link]));
  const other: HeadEntry = { kind: "submodule", path: "CLAUDE.local.md" };
  assertNotEquals(await headDigest([other]), await headDigest([]));
});

Deno.test("names become relative to the project's folder, and a path outside it climbs out", () => {
  const names = ["app/.specnaut/workflow.yml", "app/src/a.ts", "lib/x.ts", "apple", "README.md"];
  assertEquals(projectRelative(names, "app/"), [
    ".specnaut/workflow.yml",
    "src/a.ts",
    "../lib/x.ts",
    "../apple",
    "../README.md",
  ]);
  assertEquals(projectRelative(["a/b/c.txt", "a/d.txt"], "a/b/"), ["c.txt", "../d.txt"]);
  assertEquals(projectRelative(names, ""), names);
});

Deno.test("HEAD's digest frames a link with its end's bytes, and a submodule with its commit", async () => {
  const link: HeadEntry = { kind: "link", path: "CLAUDE.md", target: "notes/rules.md" };
  const ends = (text: string) => new Map([["CLAUDE.md", enc(text)]]);
  assertNotEquals(await headDigest([link], ends("one")), await headDigest([link], ends("two")));
  const sub = (commit: string): HeadEntry => ({ kind: "submodule", path: ".claude", commit });
  assertNotEquals(await headDigest([sub("a".repeat(40))]), await headDigest([sub("b".repeat(40))]));
});
