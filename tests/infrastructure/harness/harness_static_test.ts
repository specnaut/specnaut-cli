import { assertEquals } from "@std/assert";
import { applyHarnessStatic } from "../../../src/infrastructure/harness/harness_static.ts";
import type { Bundle, TemplateFile } from "../../../src/domain/template.ts";

/**
 * #612 — harness-static Markdown renders its backend markers like any
 * backlog-skill does, so a context file can say what is true for the backend
 * the project picked instead of what is true for one of four.
 */

const OPTS = {
  backlogBackend: "github",
  versionScheme: "semver",
  specBackend: "local",
} as const;

const GATED = [
  "# Context",
  "<!-- BEGIN: backend=local -->",
  "- local line",
  "<!-- END: backend=local -->",
  "<!-- BEGIN: backend=github -->",
  "- github line",
  "<!-- END: backend=github -->",
  "",
].join("\n");

Deno.test("a static Markdown file keeps only the active backend's section", () => {
  const out: Bundle = {};
  applyHarnessStatic(out, { ".acme/CONTEXT.md": { content: GATED, executable: false } }, OPTS);
  assertEquals(out[".acme/CONTEXT.md"].content, "# Context\n- github line\n");
});

Deno.test("Cursor's .mdc rules render the same way", () => {
  const out: Bundle = {};
  applyHarnessStatic(out, { ".acme/rules.mdc": { content: GATED, executable: false } }, OPTS);
  assertEquals(out[".acme/rules.mdc"].content, "# Context\n- github line\n");
});

Deno.test("non-Markdown statics pass through byte-for-byte, flags intact", () => {
  // A shell script or a JSON merge target has no HTML-comment syntax; a
  // marker-shaped line there is content, never a gate.
  const script: TemplateFile = {
    content: "#!/bin/sh\n<!-- BEGIN: backend=local -->\n",
    executable: true,
  };
  const settings: TemplateFile = {
    content: '{"hooks":{}}\n',
    executable: false,
    mergeJson: "claude-settings",
  };
  const out: Bundle = {};
  applyHarnessStatic(out, { ".acme/run.sh": script, ".acme/settings.json": settings }, OPTS);
  assertEquals(out[".acme/run.sh"], script);
  assertEquals(out[".acme/settings.json"], settings);
});

Deno.test("statics still sit on top of a core destination", () => {
  // Unchanged rule (see bundle_writer.ts): HARNESS_STATIC may overwrite a core
  // entry at the same path. Folding the uniqueness guard in here would change
  // behaviour under the guise of a refactor.
  const out: Bundle = { ".acme/CONTEXT.md": { content: "core", executable: false } };
  applyHarnessStatic(out, { ".acme/CONTEXT.md": { content: "static\n", executable: false } }, OPTS);
  assertEquals(out[".acme/CONTEXT.md"].content, "static\n");
});
