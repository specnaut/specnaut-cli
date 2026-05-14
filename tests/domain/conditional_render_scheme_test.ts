import { assertEquals, assertThrows } from "@std/assert";
import { renderScheme } from "../../src/domain/conditional_render.ts";

Deno.test("renderScheme keeps only the active scheme's block", () => {
  const src = [
    "echo before",
    "# BEGIN: scheme=semver",
    "echo SEMVER LOGIC",
    "# END: scheme=semver",
    "# BEGIN: scheme=date",
    "echo DATE LOGIC",
    "# END: scheme=date",
    "echo after",
  ].join("\n");

  assertEquals(
    renderScheme(src, "semver"),
    ["echo before", "echo SEMVER LOGIC", "echo after"].join("\n"),
  );
  assertEquals(
    renderScheme(src, "date"),
    ["echo before", "echo DATE LOGIC", "echo after"].join("\n"),
  );
});

Deno.test("renderScheme is a no-op when no scheme markers are present", () => {
  const src = "echo plain\nexit 0\n";
  assertEquals(renderScheme(src, "semver"), src);
  assertEquals(renderScheme(src, "date"), src);
});

Deno.test("renderScheme rejects unmatched BEGIN", () => {
  const src = "# BEGIN: scheme=semver\necho oops\n";
  assertThrows(() => renderScheme(src, "semver"), Error, "unmatched BEGIN");
});

Deno.test("renderScheme rejects unmatched END", () => {
  const src = "echo before\n# END: scheme=semver\n";
  assertThrows(() => renderScheme(src, "semver"), Error, "unmatched END");
});

Deno.test("renderScheme rejects nested markers", () => {
  const src = [
    "# BEGIN: scheme=semver",
    "# BEGIN: scheme=date",
    "echo nested",
    "# END: scheme=date",
    "# END: scheme=semver",
  ].join("\n");
  assertThrows(() => renderScheme(src, "semver"), Error, "nested scheme marker");
});

Deno.test("renderScheme rejects mismatched END", () => {
  const src = [
    "# BEGIN: scheme=semver",
    "echo wrong-end",
    "# END: scheme=date",
  ].join("\n");
  assertThrows(() => renderScheme(src, "semver"), Error, "mismatched END");
});

Deno.test("renderScheme drops a block whose scheme differs from active", () => {
  const src = [
    "echo before",
    "# BEGIN: scheme=date",
    "echo DATE",
    "# END: scheme=date",
    "echo after",
  ].join("\n");
  assertEquals(
    renderScheme(src, "semver"),
    ["echo before", "echo after"].join("\n"),
  );
});

Deno.test("renderScheme preserves indentation inside kept blocks", () => {
  const src = [
    "if true; then",
    "  # BEGIN: scheme=semver",
    "  echo indented",
    "  # END: scheme=semver",
    "fi",
  ].join("\n");
  assertEquals(
    renderScheme(src, "semver"),
    ["if true; then", "  echo indented", "fi"].join("\n"),
  );
});
