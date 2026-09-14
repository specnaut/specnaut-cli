import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { CODEX_CONFIG_REFUSAL, codexAgentDefaultsBlock } from "../../src/domain/codex_config.ts";
import { tierToCodexModel } from "../../src/domain/codex_models.ts";
import { mergeIntoFile, mergeRefusal } from "../../src/domain/merge_block.ts";
import { CodexHarness } from "../../src/infrastructure/harness/codex_harness.ts";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";

/**
 * cli#599 — a subagent spawned without a role must not inherit the primary
 * session's model.
 *
 * Codex resolves a child's model as: explicit spawn value → `[agents]` default
 * → the parent's value. Specnaut emitted no `[agents]` default anywhere, so for
 * a child dispatched by task description the last link was the only one. That
 * is invisible, and it compounds: raising the primary model raises every such
 * child with it.
 *
 * These assert from the GENERATED artefacts — what `mapBundle` actually emits —
 * rather than from the templates, because the defect was never in the template
 * content. Every bundled role TOML already pinned a model; the gap was that
 * nothing made a role-less dispatch land on one.
 */

const OPTS = { backlogBackend: "local", versionScheme: "semver", specBackend: "local" } as const;
const emitted = new CodexHarness().mapBundle(CORE_BUNDLE, OPTS);

Deno.test("the emitted config carries the two spawned-agent defaults and a cap", () => {
  const file = emitted[".codex/config.toml"];
  assert(file !== undefined, "no .codex/config.toml is emitted, so there is no default at all");
  assertStringIncludes(file.content, "[agents]");
  assertStringIncludes(file.content, "default_subagent_model = ");
  assertStringIncludes(file.content, "default_subagent_reasoning_effort = ");
  assertStringIncludes(file.content, "max_concurrent_threads_per_session = ");
});

Deno.test("the default model is derived from the tier map, not spelled a second time", () => {
  // `codex_models.ts` states it is the only place to edit when OpenAI renames a
  // model. This pins the RELATIONSHIP rather than the string, so a rename there
  // carries here automatically instead of leaving two ids to drift apart on
  // exactly the release that renamed one of them.
  const expected = tierToCodexModel("sonnet");
  assert(expected !== null, "the tier map no longer knows the tier this default is built from");
  assertStringIncludes(codexAgentDefaultsBlock(), `default_subagent_model = "${expected}"`);
});

Deno.test("the default is not the deepest tier", () => {
  // The whole point. A role-less child is untiered work; defaulting it to the
  // deepest model would make the silent-escalation path the designed one.
  const deepest = tierToCodexModel("opus");
  assert(deepest !== null);
  assert(
    !codexAgentDefaultsBlock().includes(`default_subagent_model = "${deepest}"`),
    "role-less children default to the most expensive tier, which is the cost " +
      "escalation this ticket exists to stop",
  );
});

Deno.test("the config is a merge block, never a whole-file write", () => {
  const file = emitted[".codex/config.toml"];
  assertEquals(
    file.mergeBlock !== undefined,
    true,
    "a whole-file write would clobber a user's existing Codex config; and " +
      "skipIfExists would skip precisely the users who already have one — the " +
      "population with this bug",
  );
  assertEquals(file.mergeRefuseIf, CODEX_CONFIG_REFUSAL);
});

Deno.test("every emitted role TOML pins a model and a reasoning effort", () => {
  const roles = Object.entries(emitted).filter(([d]) => d.startsWith(".codex/agents/"));
  assert(roles.length > 0, "the adapter emitted no role files at all");
  for (const [dest, file] of roles) {
    assertStringIncludes(file.content, "model = ", `${dest} pins no model`);
    assertStringIncludes(
      file.content,
      "model_reasoning_effort = ",
      `${dest} pins no reasoning effort, so it inherits the parent's`,
    );
  }
});

// ── The refusal: a second [agents] table is a TOML redefinition error ──────

Deno.test("an existing [agents] table outside the block refuses the merge", () => {
  const userFile = '# my config\nmodel = "gpt-5.6-sol"\n\n[agents]\nenabled = true\n';
  const refusal = mergeRefusal(userFile, emitted[".codex/config.toml"]);
  assert(refusal !== null, "the block would be appended, making the user's TOML unparseable");
  // Actionable, not merely safe: the user has to be told what to add by hand.
  assertStringIncludes(refusal, "default_subagent_model");
  assertStringIncludes(refusal, "default_subagent_reasoning_effort");
});

Deno.test("a config with no [agents] table accepts the merge", () => {
  const userFile = '# my config\nmodel = "gpt-5.6-sol"\napproval_policy = "on-request"\n';
  assertEquals(mergeRefusal(userFile, emitted[".codex/config.toml"]), null);
});

Deno.test("an absent or empty file accepts the merge", () => {
  assertEquals(mergeRefusal(null, emitted[".codex/config.toml"]), null);
  assertEquals(mergeRefusal("", emitted[".codex/config.toml"]), null);
});

Deno.test("SPECNAUT'S OWN block does not trigger its own refusal", () => {
  // The one that makes the guard usable rather than a one-shot. Our block
  // contains `[agents]`, so a naive check fires on the text we wrote last run —
  // the first upgrade would succeed and every one after it would refuse, which
  // reads exactly like a user-caused conflict.
  const file = emitted[".codex/config.toml"];
  const afterFirstRun = mergeIntoFile("# my config\n", file.content, file.mergeBlock!);
  assertStringIncludes(afterFirstRun, "[agents]");
  assertEquals(
    mergeRefusal(afterFirstRun, file),
    null,
    "the merge is not idempotent — Specnaut's own block triggers the guard",
  );
});

Deno.test("re-merging preserves the user's surrounding lines", () => {
  const file = emitted[".codex/config.toml"];
  const original = '# mine\nmodel = "gpt-5.6-sol"\n';
  const once = mergeIntoFile(original, file.content, file.mergeBlock!);
  const twice = mergeIntoFile(once, file.content, file.mergeBlock!);
  assertStringIncludes(twice, 'model = "gpt-5.6-sol"');
  assertStringIncludes(twice, "# mine");
  assertEquals(twice, once, "a second merge changed the file, so upgrade is not idempotent");
  assertEquals(
    twice.split("[agents]").length - 1,
    1,
    "a second [agents] header was added — the file no longer parses as TOML",
  );
});

Deno.test("a guard whose pattern cannot compile refuses rather than allows", () => {
  // Fails CLOSED. A guard that cannot run is not evidence that there is nothing
  // to guard against, and the cost of being wrong here is an unparseable config
  // in the user's editor.
  const refusal = mergeRefusal("[agents]\n", {
    mergeBlock: "x",
    mergeRefuseIf: { pattern: "([unclosed", message: "refused" },
  });
  assertEquals(refusal, "refused");
});

Deno.test("the bundled dispatch prose names agent_type on the Codex path", () => {
  // The other half of the fix, and the half no config can deliver: a dispatch
  // that never names a role cannot be rescued by a default, only bounded by
  // one. These three skills showed the Claude shape alone.
  for (
    const skill of [
      "using-specnaut",
      "requesting-code-review",
      "subagent-driven-development",
    ]
  ) {
    const dest = `.codex/skills/${skill}/SKILL.md`;
    const alt = Object.keys(emitted).find((d) => d.includes(skill) && d.endsWith(".md"));
    const file = emitted[dest] ?? (alt ? emitted[alt] : undefined);
    assert(file !== undefined, `${skill} is not emitted by the Codex adapter`);
    assertStringIncludes(
      file.content,
      "agent_type=",
      `${skill} documents dispatch without naming agent_type, so a reader on ` +
        `Codex follows it into the inheritance this ticket closes`,
    );
  }
});
