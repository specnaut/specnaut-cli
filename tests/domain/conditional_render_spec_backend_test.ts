import { assertEquals, assertThrows } from "@std/assert";
import { renderSpecBackend } from "../../src/domain/conditional_render.ts";

// Spec 020 — renderSpecBackend keeps the active spec backend's block and drops
// the other, mirroring renderBackend/renderScheme. Its markers are distinct
// (`spec-backend=`) so they never collide with backlog `backend=` markers.

Deno.test("renderSpecBackend keeps only the active backend's block", () => {
  const src = [
    "shared before",
    "<!-- BEGIN: spec-backend=local -->",
    "LOCAL steps",
    "<!-- END: spec-backend=local -->",
    "<!-- BEGIN: spec-backend=cloud -->",
    "CLOUD push",
    "<!-- END: spec-backend=cloud -->",
    "shared after",
  ].join("\n");

  assertEquals(
    renderSpecBackend(src, "local"),
    ["shared before", "LOCAL steps", "shared after"].join("\n"),
  );
  assertEquals(
    renderSpecBackend(src, "cloud"),
    ["shared before", "CLOUD push", "shared after"].join("\n"),
  );
});

Deno.test("renderSpecBackend is a no-op when no spec-backend markers are present", () => {
  const src = "plain line\nsecond line\n";
  assertEquals(renderSpecBackend(src, "local"), src);
  assertEquals(renderSpecBackend(src, "cloud"), src);
});

Deno.test("renderSpecBackend ignores backlog `backend=` markers (no collision)", () => {
  const src = [
    "<!-- BEGIN: backend=github -->",
    "github only",
    "<!-- END: backend=github -->",
  ].join("\n");
  // A backlog marker is plain content to the spec renderer — passed through.
  assertEquals(renderSpecBackend(src, "local"), src);
});

Deno.test("renderSpecBackend treats markers inside fenced code blocks as content", () => {
  const src = [
    "```",
    "<!-- BEGIN: spec-backend=cloud -->",
    "not a marker",
    "<!-- END: spec-backend=cloud -->",
    "```",
  ].join("\n");
  assertEquals(renderSpecBackend(src, "local"), src);
});

Deno.test("renderSpecBackend rejects unmatched / mismatched / nested markers", () => {
  assertThrows(
    () => renderSpecBackend("<!-- BEGIN: spec-backend=local -->\noops\n", "local"),
    Error,
    "unmatched BEGIN",
  );
  assertThrows(
    () => renderSpecBackend("x\n<!-- END: spec-backend=local -->\n", "local"),
    Error,
    "unmatched END",
  );
  assertThrows(
    () =>
      renderSpecBackend(
        [
          "<!-- BEGIN: spec-backend=local -->",
          "<!-- BEGIN: spec-backend=cloud -->",
          "<!-- END: spec-backend=cloud -->",
          "<!-- END: spec-backend=local -->",
        ].join("\n"),
        "local",
      ),
    Error,
    "nested spec-backend marker",
  );
});
