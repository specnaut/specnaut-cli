import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  countLines,
  countNewlines,
  DEFAULT_SIZE_LIMITS,
  readSizeLimits,
  SIZE_UNITS,
  sizeLimitsYaml,
} from "../../src/domain/size_limits.ts";

/**
 * What a line count is, and the units the config sets (spec 063, FR-002 and
 * FR-015). The grammar of the config is pinned by `size_limits_corpus_test.ts`.
 */

const bytes = (text: string) => new TextEncoder().encode(text);

/** Texts where a count that is not a newline count goes wrong. */
const SAMPLES: readonly string[] = [
  "",
  "\n",
  "\n\n\n",
  "no newline",
  "one\n",
  "one\ntwo",
  "one\r\ntwo\r\n",
  "bare\rreturn\r",
  "café \u{1F680}\nnaïve\n",
  "nul\u0000byte\n",
  " line separator is not a line\n",
];

Deno.test("countLines and countNewlines agree with a real wc -l", {
  ignore: Deno.build.os === "windows",
}, async () => {
  const dir = await Deno.makeTempDir();
  try {
    for (const [i, text] of SAMPLES.entries()) {
      const wc = await wcLines(join(dir, `sample-${i}`), text);
      assertEquals(countLines(text), wc, `countLines ${JSON.stringify(text)}`);
      assertEquals(countNewlines(bytes(text)), wc, `countNewlines ${JSON.stringify(text)}`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/** `text` written to `path`, and what `wc -l` counts in it. */
async function wcLines(path: string, text: string): Promise<number> {
  await Deno.writeTextFile(path, text);
  const { stdout } = await new Deno.Command("wc", { args: ["-l", path], stdout: "piped" }).output();
  return Number.parseInt(new TextDecoder().decode(stdout).trim(), 10);
}

Deno.test("the byte count folds over a stream, wherever the chunks are cut", () => {
  for (const text of SAMPLES) {
    const whole = bytes(text);
    for (let size = 1; size <= Math.max(whole.length, 1); size++) {
      let folded = 0;
      for (let at = 0; at < whole.length; at += size) {
        folded += countNewlines(whole.subarray(at, at + size));
      }
      assertEquals(folded, countLines(text), `${JSON.stringify(text)} cut every ${size}`);
    }
  }
});

Deno.test("the byte count reads bytes that are not UTF-8", () => {
  assertEquals(countNewlines(new Uint8Array([0xff, 0x0a, 0xc3, 0x0a, 0x00, 0x0d])), 2);
});

Deno.test("the defaults are the Clean Code limits, every unit in the table's order", () => {
  assertEquals([...SIZE_UNITS], ["file", "function", "class", "constitution"]);
  assertEquals(DEFAULT_SIZE_LIMITS, {
    file: { target: 200, ceiling: 500 },
    function: { target: 20, ceiling: 50 },
    class: { target: 100, ceiling: 200 },
    constitution: { target: 60, ceiling: 100 },
  });
});

Deno.test("class is an optional unit: absent it is the default, set it is the project's", () => {
  const absent = readSizeLimits("file:\n  target: 1\n  ceiling: 2\n");
  assertEquals(
    absent.kind === "ok" ? absent.limits.units.class : absent,
    { target: 100, ceiling: 200, source: "default" },
  );
  const set = readSizeLimits("class:\n  target: 80\n  ceiling: none\n");
  assertEquals(
    set.kind === "ok" ? set.limits.units.class : set,
    { target: 80, ceiling: null, source: "config" },
  );
});

Deno.test("what is written for a class unit is read back", () => {
  const text = sizeLimitsYaml({ class: { target: 80, ceiling: 150 } }, []);
  assertEquals(text, "class:\n  target: 80\n  ceiling: 150\n");
  const read = readSizeLimits(text);
  assertEquals(
    read.kind === "ok" ? read.limits.units.class : read,
    { target: 80, ceiling: 150, source: "config" },
  );
});
