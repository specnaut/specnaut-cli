import { assert, assertEquals } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { HARNESSES } from "../../src/cli/harnesses.ts";
import { everyBundleOption } from "../../src/application/ports.ts";

/**
 * #657 — `specnaut-guide` is the one bundled seat on the `haiku` tier, and the
 * tier has to reach each harness that has a model axis, translated into that
 * harness's own vocabulary. Asserted on what the adapters emit, not on the
 * source frontmatter: the source saying `haiku` proves nothing about the TOML
 * Codex reads.
 */

const EXPECTED: Record<string, string[]> = {
  claude: ["model: haiku"],
  codex: ['model = "gpt-5.6-luna"'],
  antigravity: ["model: flash"],
  // Provider-agnostic: the user's configured model, never a pin.
  opencode: [],
};

function guideModelLines(key: string): string[] {
  const h = HARNESSES.find((x) => x.key === key);
  assert(h, `no harness ${key}`);
  const files = Object.entries(h.mapBundle(CORE_BUNDLE, everyBundleOption()[0]))
    .filter(([path]) =>
      /specnaut-guide/.test(path) && /agents\//.test(path) && !/memory/.test(path)
    );
  assertEquals(
    files.length,
    1,
    `${key}: expected one emitted guide agent, got ${files.map(([p]) => p)}`,
  );
  const content = (files[0][1] as { content: string }).content;
  return content.split("\n").filter((l) => /^model\s*[:=]/.test(l));
}

for (const [key, expected] of Object.entries(EXPECTED)) {
  Deno.test(`${key}: specnaut-guide scaffolds on the haiku tier's model`, () => {
    assertEquals(guideModelLines(key), expected);
  });
}
