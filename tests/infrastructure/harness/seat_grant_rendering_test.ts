import { assert, assertEquals } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { CORE_BUNDLE } from "../../../src/templates_bundle.ts";
import { CodexHarness } from "../../../src/infrastructure/harness/codex_harness.ts";
import { OpenCodeHarness } from "../../../src/infrastructure/harness/opencode_harness.ts";
import {
  frontmatterField,
  splitFrontmatter,
} from "../../../src/infrastructure/harness/frontmatter.ts";
import { grantedCapabilities, isReadOnlyGrant } from "../../../src/domain/tool_grant.ts";

/**
 * Each bundled seat's grant, as the harness receives it. A grant that holds
 * only on Claude Code is a grant on one harness of several: these cases read
 * what Codex and OpenCode are actually given for every seat in the bundle.
 */

const OPTS = { backlogBackend: "local", versionScheme: "semver", specBackend: "local" } as const;
const seats = CORE_BUNDLE.filter((e) => e.category === "agent");
const toolsOf = (content: string) => {
  const split = splitFrontmatter(content);
  return split ? frontmatterField(split.fmBody, "tools") : null;
};

Deno.test("the bundle ships the seats these cases read", () => {
  assert(seats.length >= 9, `found ${seats.length} agents; the population stopped looking`);
  assert(seats.some((s) => isReadOnlyGrant(toolsOf(s.content))), "no read-only seat to check");
});

Deno.test("Codex runs every seat whose grant has no write, edit or shell in its read-only sandbox", () => {
  const out = new CodexHarness().mapBundle(seats, OPTS);
  for (const seat of seats) {
    const toml = parseToml(out[`.codex/agents/${seat.name}.toml`].content);
    const expected = isReadOnlyGrant(toolsOf(seat.content)) ? "read-only" : undefined;
    assertEquals(toml.sandbox_mode, expected, seat.name);
  }
});

Deno.test("OpenCode denies every capability a seat's grant does not hold", () => {
  const out = new OpenCodeHarness().mapBundle(seats, OPTS);
  for (const seat of seats) {
    const md = out[`.opencode/agents/specnaut-${seat.name}.md`].content;
    const granted = grantedCapabilities(toolsOf(seat.content));
    assert(granted !== null, `${seat.name} has no tools line`);
    for (const capability of ["write", "edit", "bash", "webfetch", "websearch"] as const) {
      const denied = new RegExp(`^  ${capability}: deny$`, "m").test(md);
      assertEquals(denied, !granted.has(capability), `${seat.name}: ${capability}`);
    }
  }
});
