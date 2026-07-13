import { assertEquals, assertMatch } from "@std/assert";
import {
  generateProjectKey,
  MAX_KEY_LEN,
  slugifyKeyBase,
} from "../../src/domain/cloud/project_key.ts";

// The server's constraint the generator must always satisfy.
const SERVER_KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;

Deno.test("slugifyKeyBase uppercases and strips non-alphanumerics", () => {
  assertEquals(slugifyKeyBase("Photoshop-AI"), "PHOTOSHOPA"); // 11 chars → clamped to 10
  assertEquals(slugifyKeyBase("my app"), "MYAPP");
  assertEquals(slugifyKeyBase("Cloud"), "CLOUD");
});

Deno.test("slugifyKeyBase drops leading digits so the key starts with a letter", () => {
  assertEquals(slugifyKeyBase("3D Studio"), "DSTUDIO");
  assertMatch(slugifyKeyBase("42 things"), SERVER_KEY_RE);
});

Deno.test("slugifyKeyBase pads a too-short slug to the 2-char minimum", () => {
  assertEquals(slugifyKeyBase("A"), "APROJECT");
  assertEquals(slugifyKeyBase("!!!"), "PROJECT"); // no usable chars → fallback
  assertEquals(slugifyKeyBase(""), "PROJECT");
});

Deno.test("slugifyKeyBase never exceeds MAX_KEY_LEN", () => {
  const long = slugifyKeyBase("Supercalifragilistic Expialidocious");
  assertEquals(long.length, MAX_KEY_LEN);
  assertMatch(long, SERVER_KEY_RE);
});

Deno.test("generateProjectKey returns the plain slug when it's free", () => {
  assertEquals(generateProjectKey("Cloud", []), "CLOUD");
  assertEquals(generateProjectKey("Cloud", ["TASK", "OTHER"]), "CLOUD");
});

Deno.test("generateProjectKey appends the smallest free numeric suffix on collision", () => {
  assertEquals(generateProjectKey("Cloud", ["CLOUD"]), "CLOUD2");
  assertEquals(generateProjectKey("Cloud", ["CLOUD", "CLOUD2"]), "CLOUD3");
});

Deno.test("generateProjectKey dedupes case-insensitively", () => {
  assertEquals(generateProjectKey("Cloud", ["cloud"]), "CLOUD2");
});

Deno.test("generateProjectKey truncates the base so base+suffix stays within the cap", () => {
  // "PHOTOSHOPA" (10) is taken → suffix "2" needs one char back: "PHOTOSHOP2".
  const key = generateProjectKey("Photoshop-AI", ["PHOTOSHOPA"]);
  assertEquals(key, "PHOTOSHOP2");
  assertEquals(key.length <= MAX_KEY_LEN, true);
  assertMatch(key, SERVER_KEY_RE);
});

Deno.test("generateProjectKey output always satisfies the server regex", () => {
  for (const name of ["Photoshop-AI", "3D", "!!!", "a", "My Big Long Project Name Here"]) {
    assertMatch(generateProjectKey(name, []), SERVER_KEY_RE);
  }
});
