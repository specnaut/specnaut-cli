import { assert, assertEquals } from "@std/assert";
import {
  bucketOf,
  findCandidates,
  jaccard,
  tokenize,
} from "../../scripts/gh-issues/_dedupe_heuristic.ts";

Deno.test("tokenize lowercases, splits on punctuation, drops stopwords", () => {
  const toks = tokenize("The init crashes on Windows!");
  assertEquals(
    [...toks].sort(),
    ["crashes", "init", "on", "windows"]
      // 'on' is in STOPWORDS — should be excluded, plus 'the' is in STOPWORDS
      .filter((t) => t !== "on")
      .sort(),
  );
});

Deno.test("tokenize returns Set semantics (no duplicates)", () => {
  const toks = tokenize("init init init");
  assertEquals(toks.size, 1);
  assert(toks.has("init"));
});

Deno.test("tokenize drops 1-char tokens", () => {
  const toks = tokenize("a b c init");
  assertEquals([...toks], ["init"]);
});

Deno.test("jaccard identical sets → 1.0", () => {
  const a = new Set(["init", "crash", "windows"]);
  const b = new Set(["init", "crash", "windows"]);
  assertEquals(jaccard(a, b), 1);
});

Deno.test("jaccard disjoint sets → 0.0", () => {
  const a = new Set(["alpha", "beta"]);
  const b = new Set(["gamma", "delta"]);
  assertEquals(jaccard(a, b), 0);
});

Deno.test("jaccard partial overlap → expected ratio", () => {
  // intersection = 1 ('init'); union = 3 ('init', 'crash', 'fail').
  const a = new Set(["init", "crash"]);
  const b = new Set(["init", "fail"]);
  assertEquals(jaccard(a, b), 1 / 3);
});

Deno.test("jaccard empty + empty → 0", () => {
  assertEquals(jaccard(new Set(), new Set()), 0);
});

Deno.test("bucketOf: >=0.5 → likely-dupe", () => {
  assertEquals(bucketOf(0.5), "likely-dupe");
  assertEquals(bucketOf(0.9), "likely-dupe");
});

Deno.test("bucketOf: 0.3..0.49 → maybe", () => {
  assertEquals(bucketOf(0.3), "maybe");
  assertEquals(bucketOf(0.49), "maybe");
});

Deno.test("bucketOf: <0.3 → unrelated", () => {
  assertEquals(bucketOf(0.29), "unrelated");
  assertEquals(bucketOf(0), "unrelated");
});

Deno.test("findCandidates: top-3 by score, descending", () => {
  const target = "init crashes on windows";
  const pool = [
    { number: 1, title: "init crashes on windows arm64" }, // high overlap
    { number: 2, title: "upgrade fails on macOS" },
    { number: 3, title: "init crashes when offline" }, // medium overlap
    { number: 4, title: "windows installer broken" }, // low overlap
    { number: 5, title: "completely unrelated thing about parsing" },
  ];
  const candidates = findCandidates(target, pool);
  assertEquals(candidates.length, 3);
  assertEquals(candidates[0].number, 1);
  assert(candidates[0].score > candidates[1].score);
  assert(candidates[1].score >= candidates[2].score);
});

Deno.test("findCandidates: excludeNumber drops the target itself from the pool", () => {
  const target = "init crashes on windows";
  const pool = [
    { number: 42, title: "init crashes on windows" }, // identical, but is the target
    { number: 7, title: "init crashes when offline" },
  ];
  const candidates = findCandidates(target, pool, { excludeNumber: 42 });
  assertEquals(candidates.length, 1);
  assertEquals(candidates[0].number, 7);
});

Deno.test("findCandidates: zero-overlap entries are filtered out", () => {
  const candidates = findCandidates("init crashes", [
    { number: 1, title: "completely different topic xyz" },
  ]);
  assertEquals(candidates.length, 0);
});
