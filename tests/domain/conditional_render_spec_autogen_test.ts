import { assertEquals, assertThrows } from "@std/assert";
import { renderSpecAutogen } from "../../src/domain/conditional_render.ts";

// Spec 021 — renderSpecAutogen keeps a `spec-autogen=on` block only when
// auto-generation is enabled, and strips it otherwise. Its markers are distinct
// (`spec-autogen=`) so they never collide with backlog `backend=` or spec-020
// `spec-backend=` markers.

Deno.test("renderSpecAutogen keeps the on-block only when enabled", () => {
  const src = [
    "shared before",
    "<!-- BEGIN: spec-autogen=on -->",
    "AUTOGEN guidance",
    "<!-- END: spec-autogen=on -->",
    "shared after",
  ].join("\n");

  assertEquals(
    renderSpecAutogen(src, true),
    ["shared before", "AUTOGEN guidance", "shared after"].join("\n"),
  );
  assertEquals(
    renderSpecAutogen(src, false),
    ["shared before", "shared after"].join("\n"),
  );
});

Deno.test("renderSpecAutogen is a no-op when no spec-autogen markers are present", () => {
  const src = "plain line\nsecond line\n";
  assertEquals(renderSpecAutogen(src, true), src);
  assertEquals(renderSpecAutogen(src, false), src);
});

Deno.test("renderSpecAutogen leaves backlog `backend=` markers untouched (no collision)", () => {
  const src = [
    "<!-- BEGIN: backend=cloud -->",
    "cloud backlog",
    "<!-- END: backend=cloud -->",
  ].join("\n");
  assertEquals(renderSpecAutogen(src, true), src);
  assertEquals(renderSpecAutogen(src, false), src);
});

Deno.test("renderSpecAutogen treats markers inside fenced code blocks as content", () => {
  const src = [
    "```",
    "<!-- BEGIN: spec-autogen=on -->",
    "not a marker",
    "<!-- END: spec-autogen=on -->",
    "```",
  ].join("\n");
  assertEquals(renderSpecAutogen(src, false), src);
});

Deno.test("renderSpecAutogen rejects unmatched / nested markers", () => {
  assertThrows(
    () => renderSpecAutogen("<!-- BEGIN: spec-autogen=on -->\noops\n", true),
    Error,
    "unmatched BEGIN",
  );
  assertThrows(
    () => renderSpecAutogen("x\n<!-- END: spec-autogen=on -->\n", true),
    Error,
    "unmatched END",
  );
  assertThrows(
    () =>
      renderSpecAutogen(
        [
          "<!-- BEGIN: spec-autogen=on -->",
          "<!-- BEGIN: spec-autogen=on -->",
          "<!-- END: spec-autogen=on -->",
          "<!-- END: spec-autogen=on -->",
        ].join("\n"),
        true,
      ),
    Error,
    "nested spec-autogen marker",
  );
});
