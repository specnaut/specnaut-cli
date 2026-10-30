import { assert, assertEquals } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { CodexHarness } from "../../../src/infrastructure/harness/codex_harness.ts";
import { CORE_BUNDLE } from "../../../src/templates_bundle.ts";

/**
 * The bundled fleet must reach Codex carrying the same budget distinction it
 * carries on Claude.
 *
 * This is the regression that already happened once, silently. The harness
 * derived `model_reasoning_effort` from the `model:` tier and never read
 * `effort:`. That produced a plausible spread only while the fleet was split
 * across Sonnet and Opus; the moment every agent moved to Opus, all fifteen
 * emitted `high` and the `xhigh` seats lost their budget on Codex with
 * no error, no warning, and nothing in the emitted TOML to hint at it.
 */

/** What the Codex adapter emits for the bundled fleet, with default options. */
function mapBundle() {
  return new CodexHarness().mapBundle(CORE_BUNDLE, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
}

function codexAgents(): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const [path, file] of Object.entries(mapBundle())) {
    const m = path.match(/^\.codex\/agents\/(.+)\.toml$/);
    if (m) out.set(m[1], parseToml(file.content) as Record<string, unknown>);
  }
  return out;
}

Deno.test("every bundled agent reaches Codex with an effort and no pinned model", () => {
  const agents = codexAgents();
  assert(agents.size > 0, "no Codex agent TOML emitted");
  const incomplete = [...agents.entries()]
    .filter(([, t]) => "model" in t || !t.model_reasoning_effort)
    .map(([n]) => n);
  assertEquals(
    incomplete,
    [],
    `these agents pin a model version or omit their effort: ${incomplete.join(", ")}`,
  );
});

Deno.test("the fleet does not collapse to a single reasoning effort on Codex", () => {
  const efforts = new Set(
    [...codexAgents().values()].map((t) => t.model_reasoning_effort),
  );
  assert(
    efforts.size > 1,
    `every bundled agent emitted the same effort (${[...efforts]}) — the ` +
      `budget distinction was lost in translation, which is exactly the bug ` +
      `deriving effort from the model tier used to cause`,
  );
});

Deno.test("the xhigh seats keep xhigh on Codex", () => {
  const agents = codexAgents();
  for (const name of ["architect-expert", "security-expert"]) {
    const t = agents.get(name);
    assert(t, `${name} missing from the Codex bundle`);
    assertEquals(
      t.model_reasoning_effort,
      "xhigh",
      `${name} is xhigh on Claude but ${t.model_reasoning_effort} on Codex`,
    );
  }
});

Deno.test("every emitted Codex agent names its model family, never a version", () => {
  const families = new Set(["Luna", "Terra", "Sol", "Astra"]);
  const wrong = Object.entries(mapBundle())
    .filter(([path]) => /^\.codex\/agents\/.+\.toml$/.test(path))
    .filter(([, f]) => !families.has(f.content.match(/^# Model family: (\w+)/)?.[1] ?? ""))
    .map(([path]) => path);
  assertEquals(wrong, [], `Codex agents with no known family comment: ${wrong.join(", ")}`);
});
