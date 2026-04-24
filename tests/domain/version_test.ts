import { assert, assertMatch } from "@std/assert";
import { TEMPLATES_VERSION, VERSION } from "../../src/domain/version.ts";

Deno.test("VERSION is a semver string", () => {
  assertMatch(VERSION, /^\d+\.\d+\.\d+(-[\w.]+)?$/);
});

Deno.test("TEMPLATES_VERSION is a semver string", () => {
  assertMatch(TEMPLATES_VERSION, /^\d+\.\d+\.\d+(-[\w.]+)?$/);
});

Deno.test("VERSION and TEMPLATES_VERSION are non-empty", () => {
  assert(VERSION.length > 0);
  assert(TEMPLATES_VERSION.length > 0);
});
