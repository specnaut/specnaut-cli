import { assertEquals } from "@std/assert";
import {
  BINARY_SNIFF_BYTES,
  binaryByAttribute,
  binaryBySize,
  hasNulPrefix,
} from "../../src/domain/binary_sniff.ts";

Deno.test("binaryByAttribute: -diff is binary, diff is text, anything else is the sniff's", () => {
  assertEquals(binaryByAttribute("unset"), true);
  assertEquals(binaryByAttribute("set"), false);
  for (const v of ["unspecified", "word", ""]) assertEquals(binaryByAttribute(v), null);
});

Deno.test("binaryBySize: over git's core.bigFileThreshold, 512 MiB, and not at it", () => {
  const threshold = 512 * 1024 * 1024;
  assertEquals([binaryBySize(threshold), binaryBySize(threshold + 1)], [false, true]);
});

Deno.test("hasNulPrefix: only inside git's 8000-byte window", () => {
  const at = (i: number) => {
    const b = new Uint8Array(BINARY_SNIFF_BYTES + 10).fill(0x61);
    b[i] = 0;
    return hasNulPrefix(b);
  };
  assertEquals([at(0), at(BINARY_SNIFF_BYTES - 1), at(BINARY_SNIFF_BYTES)], [true, true, false]);
});
