import { assertEquals } from "@std/assert";
import {
  EMPTY_PRESERVE_CONFIG,
  parsePreserveConfig,
  serializePreserveConfig,
} from "../../src/domain/preserve_config.ts";

Deno.test("parsePreserveConfig reads a flat preserved list", () => {
  const cfg = parsePreserveConfig(
    "preserved:\n  - .claude/agents/product-owner.md\n  - .claude/agents/developer.md\n",
  );
  assertEquals(cfg.preserved, [
    ".claude/agents/product-owner.md",
    ".claude/agents/developer.md",
  ]);
});

Deno.test("parsePreserveConfig returns EMPTY_PRESERVE_CONFIG for empty input", () => {
  assertEquals(parsePreserveConfig(""), EMPTY_PRESERVE_CONFIG);
  assertEquals(parsePreserveConfig("   \n  \n"), EMPTY_PRESERVE_CONFIG);
});

Deno.test("parsePreserveConfig degrades to empty on malformed / non-list input", () => {
  // A bare scalar, a list at the root, and a non-list `preserved` all degrade.
  assertEquals(parsePreserveConfig("just a string"), EMPTY_PRESERVE_CONFIG);
  assertEquals(parsePreserveConfig("- a\n- b\n"), EMPTY_PRESERVE_CONFIG);
  assertEquals(parsePreserveConfig("preserved: not-a-list\n"), EMPTY_PRESERVE_CONFIG);
  assertEquals(parsePreserveConfig("preserved: {a: 1}\n"), EMPTY_PRESERVE_CONFIG);
  // Genuinely unparseable YAML must not throw.
  assertEquals(parsePreserveConfig("preserved:\n  - [unterminated\n"), EMPTY_PRESERVE_CONFIG);
});

Deno.test("parsePreserveConfig normalises entries (trim, strip ./, backslash→slash)", () => {
  const cfg = parsePreserveConfig(
    "preserved:\n" +
      "  - '  .claude/agents/po.md  '\n" +
      "  - ./AGENTS.md\n" +
      "  - .claude\\agents\\dev.md\n",
  );
  assertEquals(cfg.preserved, [
    ".claude/agents/po.md",
    "AGENTS.md",
    ".claude/agents/dev.md",
  ]);
});

Deno.test("parsePreserveConfig strips ALL leading ./ segments", () => {
  const cfg = parsePreserveConfig(
    "preserved:\n  - ././x\n  - ./././y.md\n",
  );
  assertEquals(cfg.preserved, ["x", "y.md"]);
});

Deno.test("parsePreserveConfig treats YAML null (~) as no declarations", () => {
  // `preserved: ~` parses to a null value, not a list — must degrade to empty.
  assertEquals(parsePreserveConfig("preserved: ~\n"), EMPTY_PRESERVE_CONFIG);
  assertEquals(parsePreserveConfig("preserved: null\n"), EMPTY_PRESERVE_CONFIG);
});

Deno.test("parsePreserveConfig drops entries with a .. path segment (containment)", () => {
  const cfg = parsePreserveConfig(
    "preserved:\n" +
      "  - ../../etc/passwd\n" +
      "  - a/../b.md\n" +
      "  - ..\n" +
      "  - kept.md\n",
  );
  // Every `..`-bearing entry is dropped; only the clean path survives.
  assertEquals(cfg.preserved, ["kept.md"]);
});

Deno.test("parsePreserveConfig drops blanks and de-dupes preserving first order", () => {
  const cfg = parsePreserveConfig(
    "preserved:\n" +
      "  - a.md\n" +
      "  - ''\n" +
      "  - '  '\n" +
      "  - a.md\n" +
      "  - ./a.md\n" +
      "  - b.md\n",
  );
  assertEquals(cfg.preserved, ["a.md", "b.md"]);
});

Deno.test("parsePreserveConfig ignores non-string list entries", () => {
  const cfg = parsePreserveConfig("preserved:\n  - a.md\n  - 42\n  - true\n  - b.md\n");
  assertEquals(cfg.preserved, ["a.md", "b.md"]);
});

Deno.test("serializePreserveConfig round-trips through parse (idempotent on canonical input)", () => {
  const cfg = { preserved: ["a.md", "b.md"] };
  const yaml = serializePreserveConfig(cfg);
  assertEquals(parsePreserveConfig(yaml).preserved, ["a.md", "b.md"]);
  // serialize is stable / idempotent.
  assertEquals(serializePreserveConfig(parsePreserveConfig(yaml)), yaml);
  assertEquals(yaml.endsWith("\n"), true);
});

Deno.test("serializePreserveConfig of EMPTY_PRESERVE_CONFIG parses back to empty", () => {
  const yaml = serializePreserveConfig(EMPTY_PRESERVE_CONFIG);
  assertEquals(parsePreserveConfig(yaml), EMPTY_PRESERVE_CONFIG);
});
