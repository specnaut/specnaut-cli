import { assertEquals, assertThrows } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { PATTERNS } from "./cloud_patterns_fixture.ts";
import {
  compilePatterns,
  credentialKind,
  CredentialRefused,
  refuseCredentials,
} from "../../src/domain/cloud/credential_check.ts";
import { CLEAN_BODY, CLEAN_TITLE, SECRET_SAMPLES, SURVIVORS } from "../scripts/secret_samples.ts";

/**
 * The check the binary runs over text it sends to Specnaut Cloud. Its samples are the
 * ones `text_refusal_test.ts` proves the bash scan against: one list, two readers of
 * one pattern file, so the two cannot drift apart unseen.
 */

const PATTERN_FILE = new URL(
  "../../templates/core/specnaut/scripts/bash/_secret_patterns.txt",
  import.meta.url,
);

Deno.test("the binary's patterns are the file the bash scan reads, as bundled", async () => {
  const bundled = CORE_BUNDLE.find((e) => e.suffix === "scripts/bash/_secret_patterns.txt");
  assertEquals(bundled?.content, await Deno.readTextFile(PATTERN_FILE));
});

Deno.test("every secret sample is refused", () => {
  for (const sample of SECRET_SAMPLES) {
    assertEquals(credentialKind(`see ${sample} here`, PATTERNS) !== null, true, sample);
  }
});

Deno.test("a refusal names the class of the pattern that matched", () => {
  const kinds = [
    [`ghp_${"a".repeat(36)}`, "token"],
    ["password=plainwords1234", "assignment"],
    ["Authorization: x", "assignment"],
    ["Bearer abcdefgh12345", "scheme"],
  ] as const;
  for (const [sample, kind] of kinds) assertEquals(credentialKind(sample, PATTERNS), kind, sample);
});

Deno.test("clean text passes, an identifier with a pattern's prefix included", () => {
  for (const text of [...SURVIVORS, CLEAN_BODY, CLEAN_TITLE, "task-123", "Fix task-123 now"]) {
    assertEquals(credentialKind(text, PATTERNS), null, text);
  }
});

Deno.test("Markdown a spec step carries is not a credential", () => {
  const body = "## Plan\n\n<!-- a note for the reader -->\n\n[ref]: https://example.com/x\n";
  assertEquals(credentialKind(body, PATTERNS), null);
});

Deno.test("a value is measured in bytes, as grep measures it in the C locale", () => {
  // Seven characters, eight bytes: the scan's {8,} counts the bytes.
  assertEquals(credentialKind("password=héllo12", PATTERNS), "assignment");
});

Deno.test("a pattern added to the file is one the check refuses", () => {
  const source = `${Deno.readTextFileSync(PATTERN_FILE)}\nSECRET_RE acme_[0-9]{4}\n`;
  assertEquals(credentialKind("an acme_1234 value", compilePatterns(source)), "token");
  assertEquals(credentialKind("an acme_1234 value", PATTERNS), null);
});

Deno.test("a pattern file missing a pattern, or using a class it cannot read, is refused", () => {
  const source = Deno.readTextFileSync(PATTERN_FILE);
  const without = source.split("\n").filter((l) => !l.startsWith("TOKEN_LIKE_RE ")).join("\n");
  assertThrows(() => compilePatterns(without), Error, "TOKEN_LIKE_RE");
  assertThrows(() => compilePatterns(`${source}\nSECRET_RE x[[:alpha:]]`), Error, "[:alpha:]");
});

/** ERE spellings JavaScript reads differently, each with what the refusal names. */
const NOT_PORTABLE: [string, string][] = [
  ["a[]x]", "a ] first"],
  ["a[^]x]", "a ] first"],
  ["a[\\d]", "a backslash in a bracket"],
  ["a[[.x.]]", "[.x.]"],
  ["a[[=x=]]", "[=x=]"],
  ["\\<word\\>", "\\<"],
  ["word\\>", "\\>"],
  ["a{,3}", "{,n}"],
  ["a[bc", "never closed"],
];

Deno.test("a pattern grep and JavaScript would read differently is refused", () => {
  const source = Deno.readTextFileSync(PATTERN_FILE);
  for (const [ere, what] of NOT_PORTABLE) {
    assertThrows(() => compilePatterns(`${source}\nSECRET_RE ${ere}`), Error, what, ere);
  }
  compilePatterns(`${source}\nSECRET_RE a[^/[:space:]"']{1,8}\\.b`); // portable: compiles
});

Deno.test("a refusal names the field and the class, and never the value", () => {
  const value = "plainwords1234";
  const e = assertThrows(
    () => refuseCredentials(PATTERNS, [["task title", "ok"], ["step 2 body", `secret=${value}`]]),
    CredentialRefused,
  );
  assertEquals([e.field, e.kind], ["step 2 body", "assignment"]);
  assertEquals(e.message.includes(value), false);
  assertEquals(e.message.includes("step 2 body") && e.message.includes("assignment"), true);
});
