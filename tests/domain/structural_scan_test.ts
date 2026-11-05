import { assert, assertEquals, assertThrows } from "@std/assert";
import { readSizeLimits } from "../../src/domain/size_limits.ts";
import type { UnitEstimate } from "../../src/domain/code_units/estimate_units.ts";
import {
  folderOf,
  judge,
  ScanFold,
  STATEMENTS,
  TREE_DEPTH,
} from "../../src/domain/structural_scan.ts";

const config = readSizeLimits(null);
if (config.kind !== "ok") throw new Error("the defaults must read");
const LIMITS = config.limits.units;
const PROSE: UnitEstimate = { status: "not_analysed", reason: "no_units_expected" };

const fold = (tracked: number, top: number | null = 20) => new ScanFold(LIMITS, top, null, tracked);

type Kind = "function" | "class";

/** A unit the estimator found in `path`. */
const unit = (path: string, kind: Kind, name: string, startLine: number, lines: number) => ({
  path,
  kind,
  name,
  startLine,
  lines,
});

/** An analysed file, as the use case folds it. */
const analysed = (path: string, lines: number, units: ReturnType<typeof unit>[], unnamed = 0) => ({
  path,
  unit: "file" as const,
  lines,
  estimate: { status: "analysed" as const, units, unnamed },
});

Deno.test("judge: over the ceiling, over the target, within, and a rule that is off", () => {
  const limit = { target: 200, ceiling: 500, source: "default" as const };
  assertEquals(judge(limit, 501), { level: "over_ceiling", limit: 500, source: "default" });
  assertEquals(judge(limit, 500), { level: "over_target", limit: 200, source: "default" });
  assertEquals(judge(limit, 200), null);
  assertEquals(judge({ target: null, ceiling: null, source: "config" }, 10 ** 6), null);
});

Deno.test("dispositions that do not add up to what was tracked are refused, never reported", () => {
  const f = fold(3);
  f.exempt("binary");
  f.missing();
  assertThrows(() => f.report(), Error, "do not add up");
  f.skipped("symlink");
  assertEquals(f.report().totals.tracked, 3);
});

Deno.test("files over a limit: over the ceiling first, then the longest, then by path", () => {
  const f = fold(5);
  for (
    const [path, lines] of [["b.ts", 300], ["a.ts", 300], ["c.ts", 600], ["d.ts", 50]] as const
  ) {
    f.measured({ path, unit: "file", lines, estimate: PROSE });
  }
  f.measured({ path: "docs/constitution.md", unit: "constitution", lines: 101, estimate: PROSE });
  const r = f.report();
  assertEquals(r.files.items.map((x) => [x.path, x.level]), [
    ["c.ts", "over_ceiling"],
    ["docs/constitution.md", "over_ceiling"],
    ["a.ts", "over_target"],
    ["b.ts", "over_target"],
  ]);
  assertEquals(r.totals.over.constitution.over_ceiling, 1);
  assertEquals(r.totals.over.file, { over_target: 2, over_ceiling: 1 });
  assertEquals(r.statements, STATEMENTS);
});

Deno.test("every list is cut at --top, the totals and the full count are not", () => {
  const f = fold(30, 3);
  for (let i = 0; i < 30; i++) {
    f.measured({ path: `d${i % 7}/f${i}.ts`, unit: "file", lines: 201 + i, estimate: PROSE });
  }
  const r = f.report();
  assertEquals([r.files.items.length, r.files.total], [3, 30]);
  assertEquals(r.files.items[0].lines, 230);
  assertEquals([r.foldersByFiles.items.length, r.foldersByFiles.total], [3, 7]);
  assertEquals(r.totals.over.file.over_target, 30);
  const all = fold(30, null);
  for (let i = 0; i < 30; i++) {
    all.measured({ path: `f${i}`, unit: "file", lines: 201, estimate: PROSE });
  }
  assertEquals(all.report().files.items.length, 30);
});

Deno.test("units over a limit are estimated findings, ranked apart from files", () => {
  const f = fold(1);
  const units = [
    unit("a.ts", "function", "ok", 1, 20),
    unit("a.ts", "function", "long", 30, 51),
    unit("a.ts", "class", "Big", 90, 150),
  ];
  f.measured(analysed("a.ts", 10, units, 1));
  const r = f.report();
  const found = (items: typeof r.functions.items) => items.map((u) => [u.name, u.level, u.limit]);
  assertEquals(found(r.functions.items), [["long", "over_ceiling", 50]]);
  assertEquals(found(r.classes.items), [["Big", "over_target", 100]]);
  assertEquals(r.totals.units, { functions: 2, classes: 1, unnamed: 1 });
  assertEquals(r.totals.analysed, 1);
});

Deno.test("hot spots: files, then units, then folders, each given its share of the cap", () => {
  const f = fold(12, 6);
  for (let i = 0; i < 12; i++) {
    f.measured(analysed(`d${i}/f${i}.ts`, 250 + i, [unit(`f${i}.ts`, "function", "f", 1, 30 + i)]));
  }
  const kinds = f.report().hotSpots.items.map((h) => h.kind);
  assertEquals(kinds, ["file", "file", "function", "function", "folder", "folder"]);
  assertEquals(f.report().hotSpots.total, 12 + 12 + 12);
});

Deno.test("hot spots: a share a later section leaves unused goes back to an earlier one", () => {
  const f = fold(12, 6);
  for (let i = 0; i < 12; i++) {
    f.measured({
      path: `d/f${i}.ts`,
      unit: "file",
      lines: 250 + i,
      estimate: { status: "not_analysed", reason: "code_not_read" },
    });
  }
  const kinds = f.report().hotSpots.items.map((h) => h.kind);
  assertEquals(kinds.length, 6);
  assertEquals(
    kinds.filter((k) => k === "file").length,
    6 - kinds.filter((k) => k === "folder").length,
  );
});

Deno.test("folders: a path-keyed map, so a folder named __proto__ is only a folder (S9)", () => {
  const f = fold(3);
  for (const path of ["__proto__/a.ts", "__proto__/b.ts", "constructor/x.ts"]) {
    f.measured({ path, unit: "file", lines: 5, estimate: PROSE });
  }
  const r = f.report();
  assertEquals(r.foldersByFiles.items.map((x) => [x.path, x.files, x.lines]), [
    ["__proto__", 2, 10],
    ["constructor", 1, 5],
  ]);
  assertEquals(({} as Record<string, unknown>).files, undefined);
  assertEquals(folderOf("a.ts"), ".");
});

Deno.test("the tree stops at its depth, sums what is under each node, and stays connected", () => {
  const f = fold(4, 4);
  const paths = ["a/b/c/d/e.ts", "a/b/x.ts", "a-b/y.ts", "z.ts"];
  for (const [i, path] of paths.entries()) {
    f.measured({ path, unit: "file", lines: 10 * (i + 1), estimate: PROSE });
  }
  const r = f.report();
  assert(r.tree.items.every((n) => n.depth <= TREE_DEPTH));
  assertEquals(r.tree.items.map((n) => [n.path, n.lines]), [[".", 100], ["a", 30], ["a/b", 30], [
    "a-b",
    30,
  ]]);
  const kept = new Set(r.tree.items.map((n) => n.path));
  for (const n of r.tree.items) assert(n.depth <= 1 || kept.has(folderOf(n.path)), n.path);
  assertEquals(r.tree.total, 5); // ., a, a/b, a/b/c and a-b: nothing at depth 4
});
