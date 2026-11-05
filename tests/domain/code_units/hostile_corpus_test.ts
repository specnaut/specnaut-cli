import { assert, assertEquals } from "@std/assert";
import {
  estimateCodeUnits,
  MAX_LINE_BYTES,
  MAX_TEXT_BYTES,
  type UnitEstimate,
} from "../../../src/domain/code_units/estimate_units.ts";

/**
 * Generous on purpose: this is not a benchmark. Linear work on 1 MiB takes tens of milliseconds, and
 * a quadratic path over 1 MiB, or over its lines of 16 KiB, takes far longer than this on any machine.
 */
const TIME_LIMIT_MS = 3000;

/** One representative extension per family: a hostile input must be safe in every one. */
// deno-fmt-ignore
const EVERY_FAMILY = [
  "a.ts", "a.js", "a.go", "a.java", "a.cs", "a.rs", "a.php", "a.swift", "a.kt", "a.c", "a.cpp", "a.py",
];

/** The same text, wrapped under the line cap, up to the text cap: the worst that is still analysed. */
function underCaps(fragment: string): string {
  const fragmentBytes = new TextEncoder().encode(fragment).length;
  const perLine = Math.floor(MAX_LINE_BYTES / fragmentBytes);
  const line = fragment.repeat(perLine) + "\n";
  return line.repeat(Math.floor(MAX_TEXT_BYTES / (perLine * fragmentBytes + 1)));
}

function timed(path: string, text: string): UnitEstimate {
  const started = performance.now();
  const estimate = estimateCodeUnits(path, text);
  const elapsed = performance.now() - started;
  assert(elapsed < TIME_LIMIT_MS, `${path} took ${elapsed} ms on ${text.slice(0, 20)}...`);
  return estimate;
}

const WORD_RUN = "a".repeat(67);

const FRAGMENTS = [
  "word",
  "word ",
  "{",
  "}",
  "{}",
  "(",
  ")",
  "<",
  "[",
  '"',
  "'",
  "`",
  '"""',
  "'''",
  "\\",
  "/",
  "(/[",
  "/*",
  "*/",
  "//",
  "#",
  "${",
  "`${",
  "=>",
  "=> {",
  "=",
  ":",
  ".",
  "\t",
  " ",
  "\u202E",
  "\u{1F600}",
  'r#"',
  "class ",
  "class a ",
  "function ",
  "function a(){",
  "func a(){",
  "fn a(){",
  "fun a(){",
  "a(){",
  "a({",
  "def a():",
  "class a:",
  `${WORD_RUN}(`,
  `${WORD_RUN}(){`,
  `function ${WORD_RUN}(){`,
  "__proto__(){",
  "constructor(){",
];

Deno.test("every hostile fragment, wrapped under the caps, is safe in every family", () => {
  for (const path of EVERY_FAMILY) {
    for (const fragment of FRAGMENTS) {
      const estimate = timed(path, underCaps(fragment));
      assertEquals(estimate.status, "analysed", `${path} on ${fragment}`);
    }
  }
});

Deno.test("a 1 MiB run on one line is refused, whatever the run, in every family", () => {
  for (const path of EVERY_FAMILY) {
    for (const fragment of ["a", "{", "}", '"', "'", "`", "(", `${WORD_RUN}(`, "/*"]) {
      const run = fragment.repeat(Math.floor(MAX_TEXT_BYTES / fragment.length));
      assertEquals(timed(path, run), { status: "not_analysed", reason: "line_too_long" });
    }
  }
});

Deno.test("over the text cap is refused, whatever the family", () => {
  const huge = "{\n".repeat(MAX_TEXT_BYTES);
  for (const path of EVERY_FAMILY) {
    assertEquals(timed(path, huge), { status: "not_analysed", reason: "too_large" });
  }
});

Deno.test("indentation that grows on every line stays linear", () => {
  let text = "";
  for (let depth = 0; text.length + depth + 9 < MAX_TEXT_BYTES && depth < 1400; depth++) {
    text += " ".repeat(depth) + "def a():\n";
  }
  const estimate = timed("a.py", text);
  assert(estimate.status === "analysed" && estimate.units.length === 1400);
});

Deno.test("units open and never closed are all reported, each ending at the last line", () => {
  const text = "function a(){\n".repeat(1000);
  const estimate = timed("a.ts", text);
  assert(estimate.status === "analysed");
  assertEquals(estimate.units.length, 1000);
  assertEquals(estimate.units[999].lines, 1);
  assertEquals(estimate.units[0].lines, 1000);
});

Deno.test("the result is bounded by the text: never more than one unit per four characters", () => {
  for (const path of EVERY_FAMILY) {
    for (const fragment of ["a(){", "a(){}", "fn a(){}", "func a(){}", "fun a(){}", "def a():"]) {
      const text = underCaps(fragment);
      const estimate = timed(path, text);
      assert(estimate.status === "analysed");
      assert(estimate.units.length <= text.length / 4, `${path} ${fragment}`);
    }
  }
});

/** Every way a regular expression can run on a string, by the call that runs it. */
const REGEX_CALLS = [
  "RegExp",
  ".exec(",
  ".match(",
  ".matchAll(",
  ".search(",
  ".replace(",
  ".replaceAll(",
  ".split(",
  ".test(",
];

Deno.test("no pattern runs on file content: the estimator's source uses no regular expression", async () => {
  const dir = new URL("../../../src/domain/code_units/", import.meta.url);
  let seen = 0;
  for await (const entry of Deno.readDir(dir)) {
    const source = await Deno.readTextFile(new URL(entry.name, dir));
    seen++;
    for (const word of REGEX_CALLS) {
      assertEquals(source.includes(word), false, `${entry.name} uses ${word}`);
    }
  }
  assert(seen >= 5, "the guard must have read the estimator's modules");
});

Deno.test("no structure in the estimator is a plain object keyed by file content", async () => {
  const dir = new URL("../../../src/domain/code_units/", import.meta.url);
  const banned = ["Object.create", ": {}", "= {}", "Record<string"];
  for await (const entry of Deno.readDir(dir)) {
    const source = await Deno.readTextFile(new URL(entry.name, dir));
    for (const word of banned) {
      assertEquals(source.includes(word), false, `${entry.name} uses ${word}`);
    }
  }
});
