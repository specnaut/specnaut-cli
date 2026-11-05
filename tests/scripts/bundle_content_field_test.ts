import { assertEquals, assertThrows } from "@std/assert";
import {
  contentField,
  escapeTemplateLiteral,
  fmtLineWidth,
} from "../../scripts/bundle-content-field.ts";

/**
 * The bundler lays a `content:` field out as `deno fmt` would (spec 039), or
 * `deno task bundle` dirties the tree for `fmt --check`. The boundary is the
 * line width itself: a first line of exactly that length stays inline.
 */

const WIDTH = 40;
const INDENT = "    ";
/** The first line of a multi-line literal, before its text: `    content: \``. */
const OVERHEAD = `${INDENT}content: \``.length;

Deno.test("a first line of exactly the line width stays inline", () => {
  const body = "x".repeat(WIDTH - OVERHEAD);
  const field = contentField(INDENT, `${body}\nsecond line\n`, WIDTH);
  assertEquals(field.split("\n")[0].length, WIDTH);
  assertEquals(field, `${INDENT}content: \`${body}\nsecond line\n\`,\n`);
});

Deno.test("one character past the line width moves the literal to its own line", () => {
  const body = "x".repeat(WIDTH - OVERHEAD + 1);
  assertEquals(
    contentField(INDENT, `${body}\n`, WIDTH),
    `${INDENT}content:\n${INDENT}  \`${body}\n\`,\n`,
  );
});

Deno.test("the width is measured on the escaped literal, not the raw text", () => {
  // Each backtick gains a backslash, so a body that fits raw can overflow escaped.
  const raw = "`".repeat(WIDTH - OVERHEAD - 1);
  assertEquals(contentField(INDENT, `${raw}\n`, WIDTH).startsWith(`${INDENT}content:\n`), true);
});

Deno.test("escapeTemplateLiteral escapes what a template literal would interpret", () => {
  assertEquals(escapeTemplateLiteral("a\\b `c` ${d}"), "a\\\\b \\`c\\` \\${d}");
});

Deno.test("fmtLineWidth reads the width, and refuses a config that has no usable one", async () => {
  assertEquals(fmtLineWidth(`{ "fmt": { "lineWidth": 88 } }`), 88);
  // The real config answers, or the bundler would refuse it on every run.
  const real = await Deno.readTextFile(new URL("../../deno.json", import.meta.url));
  assertEquals(fmtLineWidth(real) > 0, true);
  const widths = [`"100"`, `0`, `-1`, `88.5`].map((w) => `{ "fmt": { "lineWidth": ${w} } }`);
  for (const bad of [`{}`, `{ "fmt": {} }`, ...widths]) {
    assertThrows(() => fmtLineWidth(bad), Error, "fmt.lineWidth", bad);
  }
});
