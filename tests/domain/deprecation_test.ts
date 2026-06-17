import { assertEquals } from "@std/assert";
import { isLegacyInvocation } from "../../src/domain/deprecation.ts";

Deno.test("isLegacyInvocation: true for the deprecated 'specflow' binary name", () => {
  assertEquals(isLegacyInvocation("/usr/local/bin/specflow"), true);
  assertEquals(isLegacyInvocation("C:\\Program Files\\specnaut\\specflow.exe"), true);
});

Deno.test("isLegacyInvocation: false for the current 'specnaut' binary and anything else", () => {
  assertEquals(isLegacyInvocation("/usr/local/bin/specnaut"), false);
  assertEquals(isLegacyInvocation("C:\\bin\\specnaut.exe"), false);
  assertEquals(isLegacyInvocation("/opt/deno/bin/deno"), false);
  assertEquals(isLegacyInvocation(""), false);
  // Substring, not basename, must NOT match.
  assertEquals(isLegacyInvocation("/home/specflow-user/bin/specnaut"), false);
});
