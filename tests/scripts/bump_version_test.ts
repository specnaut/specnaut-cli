import { assertEquals } from "@std/assert";
import { computeNextVersion } from "../../scripts/bump-version.ts";

Deno.test("computeNextVersion patch bump", () => {
  assertEquals(computeNextVersion("0.1.0", "patch"), "0.1.1");
});

Deno.test("computeNextVersion minor bump resets patch", () => {
  assertEquals(computeNextVersion("0.1.5", "minor"), "0.2.0");
});

Deno.test("computeNextVersion major bump resets minor and patch", () => {
  assertEquals(computeNextVersion("1.4.7", "major"), "2.0.0");
});

Deno.test("computeNextVersion drops prerelease on any simple bump", () => {
  assertEquals(computeNextVersion("0.1.0-alpha.3", "patch"), "0.1.0");
});

Deno.test("computeNextVersion prerelease bump appends/increments suffix", () => {
  assertEquals(computeNextVersion("0.1.0", "prerelease:alpha"), "0.1.1-alpha.1");
  assertEquals(
    computeNextVersion("0.1.1-alpha.1", "prerelease:alpha"),
    "0.1.1-alpha.2",
  );
});
