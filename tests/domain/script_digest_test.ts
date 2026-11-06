import { assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import { scriptsDigest } from "../../src/domain/script_digest.ts";
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
