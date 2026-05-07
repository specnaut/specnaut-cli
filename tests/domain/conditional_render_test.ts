import { assertEquals, assertThrows } from "@std/assert";
import { renderBackend } from "../../src/domain/conditional_render.ts";

Deno.test("renderBackend keeps active block content and strips markers", () => {
  const src = [
    "# common",
    "<!-- BEGIN: backend=local -->",
    "local content",
    "<!-- END: backend=local -->",
    "trailing",
  ].join("\n");
  assertEquals(
    renderBackend(src, "local"),
    ["# common", "local content", "trailing"].join("\n"),
  );
});

Deno.test("renderBackend removes inactive block (markers + content)", () => {
  const src = [
    "# common",
    "<!-- BEGIN: backend=github -->",
    "github content",
    "<!-- END: backend=github -->",
    "trailing",
  ].join("\n");
  assertEquals(renderBackend(src, "local"), ["# common", "trailing"].join("\n"));
});

Deno.test("renderBackend handles a multi-block file", () => {
  const src = [
    "# common",
    "<!-- BEGIN: backend=local -->",
    "local A",
    "<!-- END: backend=local -->",
    "shared",
    "<!-- BEGIN: backend=github -->",
    "github A",
    "<!-- END: backend=github -->",
    "trailing",
  ].join("\n");
  assertEquals(
    renderBackend(src, "github"),
    ["# common", "shared", "github A", "trailing"].join("\n"),
  );
  assertEquals(
    renderBackend(src, "local"),
    ["# common", "local A", "shared", "trailing"].join("\n"),
  );
});

Deno.test("renderBackend handles disjoint blocks for the same backend", () => {
  const src = [
    "<!-- BEGIN: backend=local -->",
    "first",
    "<!-- END: backend=local -->",
    "middle",
    "<!-- BEGIN: backend=local -->",
    "second",
    "<!-- END: backend=local -->",
  ].join("\n");
  assertEquals(
    renderBackend(src, "local"),
    ["first", "middle", "second"].join("\n"),
  );
});

Deno.test("renderBackend leaves a marker-free file unchanged", () => {
  const src = "# just markdown\nno markers here";
  assertEquals(renderBackend(src, "local"), src);
  assertEquals(renderBackend(src, "github"), src);
});

Deno.test("renderBackend ignores markers inside fenced code blocks", () => {
  const src = [
    "before",
    "```",
    "<!-- BEGIN: backend=local -->",
    "literal in code",
    "<!-- END: backend=local -->",
    "```",
    "after",
  ].join("\n");
  // Output identical for both backends — the markers are part of the code
  // sample, not directives.
  assertEquals(renderBackend(src, "local"), src);
  assertEquals(renderBackend(src, "github"), src);
});

Deno.test("renderBackend recognises markers around fenced code blocks", () => {
  const src = [
    "<!-- BEGIN: backend=local -->",
    "```bash",
    "echo hi",
    "```",
    "<!-- END: backend=local -->",
    "<!-- BEGIN: backend=github -->",
    "```bash",
    "echo bye",
    "```",
    "<!-- END: backend=github -->",
  ].join("\n");
  assertEquals(
    renderBackend(src, "local"),
    ["```bash", "echo hi", "```"].join("\n"),
  );
  assertEquals(
    renderBackend(src, "github"),
    ["```bash", "echo bye", "```"].join("\n"),
  );
});

Deno.test("renderBackend treats unknown backend names as inactive", () => {
  // The renderer is permissive: an unknown backend in a marker is simply
  // never the active one, so its block is stripped. The CLI is responsible
  // for validating known backend names before scaffolding.
  const src = [
    "<!-- BEGIN: backend=gitlab -->",
    "future content",
    "<!-- END: backend=gitlab -->",
    "kept",
  ].join("\n");
  assertEquals(renderBackend(src, "local"), "kept");
  assertEquals(renderBackend(src, "github"), "kept");
});

Deno.test("renderBackend throws on unmatched BEGIN", () => {
  const src = [
    "<!-- BEGIN: backend=local -->",
    "no end",
  ].join("\n");
  assertThrows(() => renderBackend(src, "local"), Error, "unmatched BEGIN");
});

Deno.test("renderBackend throws on unmatched END", () => {
  const src = [
    "stuff",
    "<!-- END: backend=local -->",
  ].join("\n");
  assertThrows(() => renderBackend(src, "local"), Error, "unmatched END");
});

Deno.test("renderBackend throws on nested markers", () => {
  const src = [
    "<!-- BEGIN: backend=local -->",
    "<!-- BEGIN: backend=github -->",
    "x",
    "<!-- END: backend=github -->",
    "<!-- END: backend=local -->",
  ].join("\n");
  assertThrows(() => renderBackend(src, "local"), Error, "nested");
});

Deno.test("renderBackend throws on mismatched BEGIN/END pair", () => {
  const src = [
    "<!-- BEGIN: backend=local -->",
    "x",
    "<!-- END: backend=github -->",
  ].join("\n");
  assertThrows(() => renderBackend(src, "local"), Error, "mismatched");
});

Deno.test("renderBackend tolerates whitespace around marker syntax", () => {
  const src = [
    "  <!-- BEGIN: backend=local -->  ",
    "kept",
    "  <!-- END: backend=local -->  ",
  ].join("\n");
  assertEquals(renderBackend(src, "local"), "kept");
});
