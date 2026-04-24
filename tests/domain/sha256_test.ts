import { assertEquals } from "@std/assert";
import { sha256Hex } from "../../src/domain/sha256.ts";

Deno.test("sha256Hex of empty string is the known constant", async () => {
  assertEquals(
    await sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

Deno.test("sha256Hex of a short string", async () => {
  assertEquals(
    await sha256Hex("hello"),
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  );
});

Deno.test("sha256Hex is deterministic", async () => {
  const a = await sha256Hex("hello world");
  const b = await sha256Hex("hello world");
  assertEquals(a, b);
});

Deno.test("sha256Hex handles unicode correctly", async () => {
  const digest = await sha256Hex("é");
  assertEquals(digest.length, 64);
});
