import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { BINARY_SNIFF_BYTES } from "../../src/domain/binary_sniff.ts";
import {
  GENERATED_GLOBS,
  GENERATED_PHRASES,
  generatedByPath,
  hasGeneratedMarker,
  MARKER_LINES,
} from "../../src/domain/generated_code.ts";

/**
 * What counts as generated code has three copies: `_size_exempt.sh`, which the ratchet sources in a
 * project, `generated_code.ts`, which `specnaut scan` asks, and the prose of `size-limits.md`,
 * which a project reads. These tests hold the TypeScript copy to the other two, and pin each signal
 * at its edges.
 */

const template = (path: string) =>
  Deno.readTextFile(fromFileUrl(new URL(`../../templates/core/specnaut/${path}`, import.meta.url)));
const source = await template("scripts/bash/_size_exempt.sh");
const prose = await template("memory/size-limits.md");

/**
 * The words of the script's `<name>=(...)` assignment, in either quote or none: an entry one side
 * adds in a quoting this parse skipped would never be compared.
 */
function scriptArray(name: string): string[] {
  const body = source.match(new RegExp(`^${name}=\\(([^)]*)\\)`, "m"))?.[1] ?? "";
  return [...body.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/** The script's `<name>=<number>` setting. */
const scriptNumber = (name: string): number =>
  Number(source.match(new RegExp(`\\b${name}=(\\d+)`))?.[1]);

Deno.test("the generated globs and phrases are the script's, in its order", () => {
  const globs = scriptArray("SIZE_GENERATED_GLOBS");
  const phrases = scriptArray("SIZE_GENERATED_PHRASES");
  // Not agreement on an empty answer: a parse that found nothing would equal an empty list.
  assert(globs.length >= 10, `parsed too few globs from the script: ${globs}`);
  assert(phrases.length >= 4, `parsed too few phrases from the script: ${phrases}`);
  assertEquals([...GENERATED_GLOBS], globs);
  assertEquals([...GENERATED_PHRASES], phrases);
});

Deno.test("the header window is the script's: git's sniff bytes, then the first lines", () => {
  assertEquals(scriptNumber("SIZE_GENERATED_WINDOW_BYTES"), BINARY_SNIFF_BYTES);
  assertEquals(scriptNumber("SIZE_GENERATED_WINDOW_LINES"), MARKER_LINES);
});

/** The prose bullet opening on `**<label>**`, up to the next bullet or a blank line. */
const bullet = (label: string): string =>
  prose.match(new RegExp(`^- \\*\\*${label}\\*\\*[^]*?(?=\\n- |\\n\\n)`, "m"))?.[0] ?? "";
const ticked = (text: string) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

// The prose writes a lockfile glob of the form star-slash-name bare: "lockfiles at any depth".
const asProse = (glob: string) => /^\*\/[^*/]+$/.test(glob) ? glob.slice(2) : glob;

Deno.test("size-limits.md states the generated globs, phrases and window of the code", () => {
  const names = ticked(bullet("Its name"));
  const header = bullet("Its header");
  assert(names.length >= 10, `parsed too few globs from the prose: ${names}`);
  assertEquals(names, GENERATED_GLOBS.map(asProse));
  assertEquals(ticked(header), [...GENERATED_PHRASES]);
  assertStringIncludes(
    header.replace(/\s+/g, " "),
    `first ${MARKER_LINES} lines and first ${BINARY_SNIFF_BYTES} bytes`,
  );
});

Deno.test("generatedByPath: the names code generators give their output, at any depth", () => {
  for (
    const path of [
      "src/_generated/api.ts",
      "_generated/api.ts",
      "web/__generated__/q.ts",
      "src/api.gen.ts",
      "src/api.generated.ts",
      "src/api_generated.go",
      "pb/svc.pb.go",
      "py/svc_pb2.py",
      "py/svc_pb2_grpc.py",
      "lib/m.g.dart",
      "lib/m.freezed.dart",
      "Cargo.lock",
      "deep/yarn.lock",
      "package-lock.json",
      "web/package-lock.json",
      "web/npm-shrinkwrap.json",
      "web/pnpm-lock.yaml",
      "svc/go.sum",
    ]
  ) assert(generatedByPath(path), path);
});

Deno.test("generatedByPath: a name that only resembles one is authored", () => {
  for (
    const path of [
      "src/generated.ts",
      "src/gen/api.ts",
      "src/generator.ts",
      "src/regenerate.ts",
      "docs/lockfiles.md",
      "web/my-package-lock.json",
    ]
  ) assert(!generatedByPath(path), path);
});

Deno.test("generatedByPath: a name holding a control character is never generated", () => {
  for (const c of ["\n", "\r", "\t", "\x01", "\x1b", "\x1f", "\x7f", "\x80", "\x9b", "\x9f"]) {
    assert(!generatedByPath(`a${c}b.gen.ts`), JSON.stringify(c));
  }
  // The first printable past C1, and a letter whose UTF-8 holds a byte in C1's range: generated.
  assertEquals([generatedByPath("a\xa0b.gen.ts"), generatedByPath("aĀb.gen.ts")], [true, true]);
});

const bytes = (text: string) => new TextEncoder().encode(text);
const body = "export const x = 1;\n".repeat(20);

Deno.test("hasGeneratedMarker: each phrase, in any case, anywhere on a header line", () => {
  for (const phrase of GENERATED_PHRASES) {
    const shouted = phrase.toUpperCase();
    assert(hasGeneratedMarker(bytes(`// ${shouted} by a tool\n${body}`)), phrase);
  }
  assert(hasGeneratedMarker(bytes(`# Code Generated by protoc.\n${body}`)));
});

Deno.test("hasGeneratedMarker: 'do not edit' alone is what a hand-written file says too", () => {
  assert(!hasGeneratedMarker(bytes(`// DO NOT EDIT without a review\n${body}`)));
  assert(!hasGeneratedMarker(bytes(`// generated by hand, then edited\n${body}`)));
});

Deno.test("hasGeneratedMarker: the first five lines only", () => {
  const at = (line: number) =>
    hasGeneratedMarker(bytes("x\n".repeat(line - 1) + "// @generated\n" + body));
  assertEquals([at(1), at(MARKER_LINES), at(MARKER_LINES + 1)], [true, true, false]);
});

Deno.test("hasGeneratedMarker: the first 8000 bytes only, even on the first line", () => {
  const ending = (end: number) =>
    hasGeneratedMarker(bytes("x".repeat(end - "@generated".length) + "@generated\n" + body));
  assertEquals([ending(BINARY_SNIFF_BYTES), ending(BINARY_SNIFF_BYTES + 1)], [true, false]);
});

Deno.test("hasGeneratedMarker: a NUL splitting a phrase hides it, as it does from the ratchet", () => {
  assert(!hasGeneratedMarker(bytes(`// @gener\0ated\n${body}`)));
  assert(hasGeneratedMarker(bytes(`\0// @generated\n${body}`)));
});
