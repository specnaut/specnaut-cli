import { assertEquals } from "@std/assert";
import { isFullSha } from "../../src/domain/commit_sha.ts";

Deno.test("a commit id is 40 or 64 lowercase hex digits and nothing else", () => {
  assertEquals(isFullSha("a".repeat(40)), true);
  assertEquals(isFullSha("0123456789abcdef".repeat(4)), true);
  const bad = [
    "a".repeat(39),
    "a".repeat(41),
    "a".repeat(63),
    "A".repeat(40),
    `${"a".repeat(40)}\n`,
  ];
  for (const id of [...bad, `../${"a".repeat(37)}`, "g".repeat(40), ""]) {
    assertEquals(isFullSha(id), false, JSON.stringify(id));
  }
});
