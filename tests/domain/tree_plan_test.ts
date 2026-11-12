import { assertEquals, assertThrows } from "@std/assert";
import {
  DEFAULT_TREE_CAPS,
  type TreeCaps,
  type TreeEntry,
  TreePlanner,
  TreeRefused,
} from "../../src/domain/tree_plan.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const sha = (c: string) => c.repeat(40);
const entry = (mode: string, name: string | Uint8Array, id = sha("a")): TreeEntry => ({
  mode,
  name: typeof name === "string" ? enc(name) : name,
  sha: id,
});
const ROOT = { names: [], sha: sha("0") };
const planner = (caps: Partial<TreeCaps> = {}) =>
  new TreePlanner({ ...DEFAULT_TREE_CAPS, ...caps }, false);

function refusal(fn: () => unknown): string[] {
  const err = assertThrows(fn, TreeRefused);
  return [...err.faults];
}

Deno.test("regular blobs are planned, trees are handed back to read next", () => {
  const p = planner();
  const next = p.admit(ROOT, [
    entry("100644", "a.txt", sha("1")),
    entry("100755", "run.sh", sha("2")),
    entry("40000", "src", sha("3")),
  ]);
  assertEquals(next, [{ names: ["src"], sha: sha("3") }]);
  p.admit(next[0], [entry("100644", "b.ts", sha("4"))]);
  const plan = p.finish();
  assertEquals(plan.files.map((f) => [f.path, f.executable]), [
    ["a.txt", false],
    ["run.sh", true],
    ["src/b.ts", false],
  ]);
  assertEquals(plan.listed, []);
});

Deno.test("links, submodules and other modes are listed, never planned", () => {
  const p = planner();
  p.admit(ROOT, [
    entry("120000", "link", sha("1")),
    entry("160000", "sub", sha("2")),
    entry("100664", "odd", sha("3")),
  ]);
  const plan = p.finish();
  assertEquals(plan.files, []);
  assertEquals(plan.listed, [
    { path: "link", sha: sha("1"), kind: "link" },
    { path: "sub", sha: sha("2"), kind: "submodule" },
    { path: "odd", sha: sha("3"), kind: "unsupported mode 100664" },
  ]);
});

Deno.test("instruction files are listed with their blob id, at any depth", () => {
  const p = planner();
  const [claude] = p.admit(ROOT, [
    entry("100644", "CLAUDE.md", sha("1")),
    entry("40000", ".claude", sha("2")),
  ]);
  p.admit(claude, [entry("100755", "hook.sh", sha("3"))]);
  const plan = p.finish();
  assertEquals(plan.files, []);
  assertEquals(plan.listed, [
    { path: "CLAUDE.md", sha: sha("1"), kind: "instruction" },
    { path: ".claude/hook.sh", sha: sha("3"), kind: "instruction" },
  ]);
});

Deno.test("every bad name is refused, with its path, and nothing is planned", () => {
  const p = planner();
  const [dir] = p.admit(ROOT, [entry("40000", "pkg", sha("1"))]);
  p.admit(dir, [
    entry("100644", ".GIT"),
    entry("100644", ".."),
    entry("100644", ""),
    entry("100644", "a/b"),
    entry("100644", new Uint8Array([0xff])),
    entry("100644", "ok"),
  ]);
  assertEquals(refusal(() => p.finish()), [
    `pkg/.GIT: a spelling of .git`,
    `pkg/..: a '.' or '..' step`,
    `pkg/: an empty name`,
    `pkg/a/b: a path separator`,
    `pkg/�: a name that is not UTF-8`,
  ]);
});

Deno.test("a bad name on a tree is not descended into", () => {
  const p = planner();
  assertEquals(p.admit(ROOT, [entry("40000", ".git", sha("1"))]), []);
});

Deno.test("case-fold twins in one folder are refused, across folders they are not", () => {
  const p = planner();
  const [a, b] = p.admit(ROOT, [entry("40000", "a", sha("1")), entry("40000", "b", sha("2"))]);
  p.admit(a, [entry("100644", "README"), entry("100644", "readme")]);
  p.admit(b, [entry("100644", "README")]);
  assertEquals(refusal(() => p.finish()), [
    "a/readme: a twin of another name in its folder on a case- or form-insensitive filesystem",
  ]);
});

Deno.test("a twin is refused even when one of the pair is an instruction file", () => {
  const p = planner();
  p.admit(ROOT, [entry("100644", "CLAUDE.md"), entry("100644", "claude.md")]);
  assertEquals(refusal(() => p.finish()).length, 1);
});

Deno.test("the entry cap refuses at once, before another tree is read", () => {
  const p = planner({ entries: 2 });
  p.admit(ROOT, [entry("100644", "a"), entry("100644", "b")]);
  assertEquals(refusal(() => p.admit(ROOT, [entry("100644", "c")])), [
    "the tree holds more than 2 entries",
  ]);
});

Deno.test("the depth cap refuses at once", () => {
  const p = planner({ depth: 2 });
  const deep = { names: ["a", "b"], sha: sha("1") };
  assertEquals(refusal(() => p.admit(deep, [entry("100644", "c")])), [
    "a/b/c: deeper than 2 folders",
  ]);
  assertEquals(planner({ depth: 3 }).admit(deep, [entry("100644", "c")]), []);
});

Deno.test("a path over the length cap is refused", () => {
  const p = planner({ pathBytes: 5 });
  p.admit(ROOT, [entry("100644", "abcde"), entry("100644", "abcdef")]);
  assertEquals(refusal(() => p.finish()), ["abcdef: a path over 5 bytes"]);
});

Deno.test("the byte cap counts every charge and refuses past it", () => {
  const p = planner({ bytes: 10 });
  p.charge(6);
  p.charge(4);
  assertEquals(refusal(() => p.charge(1)), ["the tree holds more than 10 bytes"]);
});

Deno.test("the defaults are bounded", () => {
  const caps = DEFAULT_TREE_CAPS;
  assertEquals(caps.entries <= 100_000 && caps.depth <= 32 && caps.pathBytes <= 1024, true);
  assertEquals(caps.bytes <= 256 * 2 ** 20, true);
});

Deno.test("a folder laid out as a git repository is listed whole, never written", () => {
  const layouts = [
    ["HEAD", "objects", "refs"],
    ["Head", "OBJECTS", "refs"],
    ["commondir"],
    ["gitdir"],
  ];
  for (const layout of layouts) {
    const p = planner();
    const [dir] = p.admit(ROOT, [entry("40000", "fixture", sha("1"))]);
    const inside = layout.map((n, i) =>
      entry(n === "HEAD" ? "100644" : "40000", n, sha(`${i + 2}`))
    );
    assertEquals(p.admit(dir, [...inside, entry("100644", "config")]), [], layout.join(","));
    assertEquals(p.finish(), {
      files: [],
      listed: [{ path: "fixture", sha: sha("1"), kind: "repository" }],
    });
  }
});

Deno.test("the root tree itself is judged as a repository too", () => {
  const p = planner();
  p.admit(ROOT, [entry("100644", "HEAD"), entry("40000", "objects"), entry("40000", "refs")]);
  assertEquals(p.finish(), {
    files: [],
    listed: [{ path: ".", sha: sha("0"), kind: "repository" }],
  });
});

Deno.test("two of the three repository names are an ordinary folder", () => {
  const p = planner();
  p.admit(ROOT, [entry("100644", "HEAD"), entry("100644", "objects")]);
  assertEquals(p.finish().files.map((f) => f.path), ["HEAD", "objects"]);
});
