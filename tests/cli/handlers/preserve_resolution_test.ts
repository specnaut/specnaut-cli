import { assertEquals } from "@std/assert";
import { resolvePreserveDeclarations } from "../../../src/cli/handlers/preserve_resolution.ts";
import { EMPTY_PRESERVE_CONFIG } from "../../../src/domain/preserve_config.ts";

// T017 / FR-008 (C7): a declared path that is NOT a managed bundle dest is
// ineffective — it lands in `unknown` (exactly one warn at the handler), never
// in `known`, and never aborts. Real bundle dests partition into `known`.
Deno.test("resolvePreserveDeclarations: splits known bundle dests from unknown declarations", () => {
  const cfg = {
    preserved: [".claude/agents/product-owner.md", "not/a/bundled/file.md"],
  };
  const bundleDests = [".claude/agents/product-owner.md", "AGENTS.md"];
  const { known, unknown } = resolvePreserveDeclarations(cfg, bundleDests);
  assertEquals(known, [".claude/agents/product-owner.md"]);
  // Exactly one ineffective declaration is surfaced for a single warn line.
  assertEquals(unknown, ["not/a/bundled/file.md"]);
});

Deno.test("resolvePreserveDeclarations: a declaration absent from the bundle is unknown, not honoured (FR-008)", () => {
  const cfg = { preserved: ["typo/path.md"] };
  const { known, unknown } = resolvePreserveDeclarations(cfg, [".claude/agents/product-owner.md"]);
  assertEquals(known, []);
  assertEquals(unknown, ["typo/path.md"]);
});

Deno.test("resolvePreserveDeclarations: empty config yields empty partitions", () => {
  const { known, unknown } = resolvePreserveDeclarations(EMPTY_PRESERVE_CONFIG, ["AGENTS.md"]);
  assertEquals(known, []);
  assertEquals(unknown, []);
});

// Declaration order is preserved across both partitions for deterministic
// notice/warning rendering.
Deno.test("resolvePreserveDeclarations: preserves declaration order in both partitions", () => {
  const cfg = { preserved: ["z.md", "a.md", "missing.md", "m.md"] };
  const { known, unknown } = resolvePreserveDeclarations(cfg, ["a.md", "m.md", "z.md"]);
  assertEquals(known, ["z.md", "a.md", "m.md"]);
  assertEquals(unknown, ["missing.md"]);
});
