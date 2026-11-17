import { assertEquals } from "@std/assert";
import {
  type IndexedPath,
  linkOnTheWay,
  pathIndex,
  throughLinks,
  twinsAtHead,
} from "../../src/domain/path_index.ts";

/** A commit's listing as the instruction walk looks a path up in it: folded, through links. */

const at = (path: string, kind: IndexedPath["kind"] = "blob", target?: string): IndexedPath =>
  target === undefined ? { path, kind } : { path, kind, target };

Deno.test("a twin is any other path under the folded name, a folder aside", () => {
  const index = pathIndex([
    at("docs/rules.md"),
    at("docs/Rules.md"),
    at("Docs/RULES.md", "link", "x.md"),
    at("DOCS/rules.md", "submodule"),
    at("docs/RULES.MD", "tree"),
    at("docs/other.md"),
  ]);
  assertEquals(twinsAtHead("docs/rules.md", index).map((t) => t.path), [
    "docs/Rules.md",
    "Docs/RULES.md",
    "DOCS/rules.md",
  ]);
  assertEquals(twinsAtHead("docs/none.md", index), []);
});

Deno.test("a name in another Unicode normalisation is a twin: the disk folds it too", () => {
  const nfd = "docs/café.md";
  const index = pathIndex([at("docs/café.md"), at(nfd)]);
  assertEquals(twinsAtHead("docs/café.md", index).map((t) => t.path), [nfd]);
});

Deno.test("the first link on a path's way, the path itself included, folded", () => {
  const index = pathIndex([at("shared", "link", "docs"), at("docs", "tree"), at("x.md", "link")]);
  assertEquals(linkOnTheWay("Shared/a/b.md", index)?.path, "shared");
  assertEquals(linkOnTheWay("x.md", index)?.path, "x.md");
  assertEquals(linkOnTheWay("docs/a.md", index), undefined);
});

Deno.test("a path leads through each link on its way to the file a session reads", () => {
  const index = pathIndex([
    at("shared", "link", "docs"),
    at("docs/rules.md", "link", "../notes/rules.md"),
    at("abs", "link", "/etc"),
    at("up", "link", "../../.."),
    at("loop", "link", "loop"),
    at("../top", "link", "x"),
  ]);
  assertEquals(throughLinks("app/", "shared/rules.md", index), { end: "notes/rules.md" });
  assertEquals(throughLinks("app/", "plain.md", index), { end: "plain.md" });
  assertEquals(throughLinks("app/", "abs/passwd", index), { outside: "abs" });
  assertEquals(throughLinks("app/", "up/x.md", index), { outside: "up" });
  assertEquals(throughLinks("app/", "loop/x.md", index), { outside: "loop/x.md" });
  assertEquals(throughLinks("app/", "../top/a.md", index), { end: "../x/a.md" });
  assertEquals(throughLinks("", "../top/a.md", pathIndex([])), { end: "../top/a.md" });
});
