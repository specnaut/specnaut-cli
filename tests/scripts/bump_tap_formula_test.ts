import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderFormula } from "../../scripts/bump-tap-formula.ts";

Deno.test("renderFormula produces a Ruby Formula class with the right shape", () => {
  const out = renderFormula({
    tag: "v1.2.3",
    version: "1.2.3",
    shaMacOsArm: "a".repeat(64),
    shaMacOsX64: "b".repeat(64),
    shaLinuxArm: "c".repeat(64),
    shaLinuxX64: "d".repeat(64),
  });
  assertStringIncludes(out, "class Specflow < Formula");
  assertStringIncludes(out, 'version "1.2.3"');
  assertStringIncludes(out, "v1.2.3/specflow-macos-arm64");
  assertStringIncludes(out, "v1.2.3/specflow-macos-x64");
  assertStringIncludes(out, "v1.2.3/specflow-linux-arm64");
  assertStringIncludes(out, "v1.2.3/specflow-linux-x64");
  assertStringIncludes(out, `sha256 "${"a".repeat(64)}"`);
  assertStringIncludes(out, `sha256 "${"d".repeat(64)}"`);
  assertStringIncludes(out, "on_macos do");
  assertStringIncludes(out, "on_linux do");
  assertStringIncludes(out, "test do");
});

Deno.test("renderFormula leaves no unrendered placeholders in the output", () => {
  const out = renderFormula({
    tag: "v0.0.1",
    version: "0.0.1",
    shaMacOsArm: "a".repeat(64),
    shaMacOsX64: "a".repeat(64),
    shaLinuxArm: "a".repeat(64),
    shaLinuxX64: "a".repeat(64),
  });
  // Catch accidental sed-style markers or shell-style literal substitutions.
  assertEquals(out.includes("@@"), false);
  // The Ruby `#{version}` interpolation in the test block is *intentional*
  // and must be preserved verbatim — so we don't assert on `#{`.
});

Deno.test("renderFormula keeps Ruby string interpolation in the test block", () => {
  const out = renderFormula({
    tag: "v9.9.9",
    version: "9.9.9",
    shaMacOsArm: "0".repeat(64),
    shaMacOsX64: "0".repeat(64),
    shaLinuxArm: "0".repeat(64),
    shaLinuxX64: "0".repeat(64),
  });
  // The test stub must use Ruby's #{version} (not the literal "9.9.9") so
  // brew test resolves it from the formula's own version field at install
  // time.
  assertStringIncludes(out, "/^specflow #{version}/");
});
