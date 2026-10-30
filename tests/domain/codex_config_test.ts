import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  CODEX_AGENTS_KEYS,
  CODEX_CONFIG_REFUSAL,
  codexAgentDefaultsBlock,
} from "../../src/domain/codex_config.ts";
import { mergeIntoFile, mergeRefusal } from "../../src/domain/merge_block.ts";
import { CodexHarness } from "../../src/infrastructure/harness/codex_harness.ts";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";

/**
 * The `[agents]` defaults a Codex project gets (cli#599, revised by cli#707).
 *
 * Two things are pinned. A subagent spawned without a role gets a `medium`
 * reasoning default, so untiered work does not run at the session's deepest
 * budget by accident; and the session's subagents are capped in number. No
 * model is set anywhere — every child, role or not, runs on the session's
 * model, because Specnaut names no model version.
 *
 * These assert from the GENERATED artefacts — what `mapBundle` actually emits —
 * rather than from the templates, because what reaches the user is the
 * adapter's output, not the template it started from.
 */

const OPTS = { backlogBackend: "local", versionScheme: "semver", specBackend: "local" } as const;
const emitted = new CodexHarness().mapBundle(CORE_BUNDLE, OPTS);

Deno.test("the emitted config carries the reasoning default and a cap", () => {
  const file = emitted[".codex/config.toml"];
  assert(file !== undefined, "no .codex/config.toml is emitted, so there is no default at all");
  assertStringIncludes(file.content, "[agents]");
  assertStringIncludes(file.content, "default_subagent_reasoning_effort = ");
  assertStringIncludes(file.content, "max_concurrent_threads_per_session = ");
});

Deno.test("the block names no model: a version would be obsolete within weeks (cli#707)", () => {
  assert(
    !/^\s*default_subagent_model\s*=/m.test(codexAgentDefaultsBlock()),
    "a default model is pinned",
  );
  assert(!(CODEX_AGENTS_KEYS as readonly string[]).includes("default_subagent_model"));
});

Deno.test("the reasoning default is not the deepest budget", () => {
  // The whole point of cli#599: a role-less child is untiered work, and
  // defaulting it to the deepest budget would make silent escalation the design.
  assert(!codexAgentDefaultsBlock().includes('default_subagent_reasoning_effort = "xhigh"'));
  assertStringIncludes(codexAgentDefaultsBlock(), 'default_subagent_reasoning_effort = "medium"');
});

Deno.test("the comment calls the reasoning effort a default, not a cap", () => {
  // A role TOML may set a deeper budget, so the value is a floor for role-less
  // children, never a ceiling. The comment names the value the block writes.
  const block = codexAgentDefaultsBlock();
  const effort = block.match(/^default_subagent_reasoning_effort = "(\w+)"$/m)?.[1];
  assert(effort, "the block writes no reasoning default");
  assertStringIncludes(block, `sets a ${effort} default`);
  assert(!/\bcaps\b/.test(block), "the comment calls the reasoning default a cap");
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

Deno.test("every emitted role TOML pins a reasoning effort and no model", () => {
  const roles = Object.entries(emitted).filter(([d]) => d.startsWith(".codex/agents/"));
  assert(roles.length > 0, "the adapter emitted no role files at all");
  for (const [dest, file] of roles) {
    assert(!/^model\s*=/m.test(file.content), `${dest} pins a model version`);
    assertStringIncludes(
      file.content,
      "model_reasoning_effort = ",
      `${dest} pins no reasoning effort, so it inherits the parent's`,
    );
  }
});

// ── The refusal: a second [agents] table is a TOML redefinition error ──────

Deno.test("an existing [agents] table outside the block refuses the merge", () => {
  const userFile = '# my config\nmodel = "my-model"\n\n[agents]\nenabled = true\n';
  const refusal = mergeRefusal(userFile, emitted[".codex/config.toml"]);
  assert(refusal !== null, "the block would be appended, making the user's TOML unparseable");
  // Actionable, not merely safe: the user has to be told what to add by hand.
  assertStringIncludes(refusal, "default_subagent_reasoning_effort");
  assertStringIncludes(refusal, "max_concurrent_threads_per_session");
});

Deno.test("a config with no [agents] table accepts the merge", () => {
  const userFile = '# my config\nmodel = "my-model"\napproval_policy = "on-request"\n';
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
  const original = '# mine\nmodel = "my-model"\n';
  const once = mergeIntoFile(original, file.content, file.mergeBlock!);
  const twice = mergeIntoFile(once, file.content, file.mergeBlock!);
  assertStringIncludes(twice, 'model = "my-model"');
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

Deno.test("the always-on AGENTS.md names agent_type on the Codex path", () => {
  // The other half of the fix, and the half no config can deliver: a dispatch
  // that never names a role cannot be rescued by a default, only bounded by
  // one. Since spec 034 the rule has one home, the AGENTS.md every Codex
  // session loads.
  const file = emitted["AGENTS.md"];
  assert(file !== undefined, "AGENTS.md is not emitted by the Codex adapter");
  assertStringIncludes(
    file.content,
    "agent_type=",
    "AGENTS.md documents dispatch without naming agent_type, so a reader on " +
      "Codex follows it into the role-less dispatch cli#599 bounds",
  );
  // Name- and description-dispatch both run on the session's model (cli#707);
  // what a description-dispatched child loses on Codex is the role's budget.
  assert(
    !file.content.includes("primary session's model"),
    "AGENTS.md still says a description-dispatched child runs on a different model",
  );
  assertStringIncludes(file.content, "without its reasoning budget");
});

Deno.test("the block enables agents explicitly (cli#681), and never writes the legacy alias", () => {
  const block = codexAgentDefaultsBlock();
  assert(/^enabled = true$/m.test(block), "no `enabled = true` under [agents]");
  assert(!/^max_threads\s*=/m.test(block), "`max_threads` is a legacy alias of the cap");
  assert(/^max_concurrent_threads_per_session = \d+$/m.test(block), "no concurrency cap");
});

Deno.test("the refusal names every key the block writes, and the list is the block's", () => {
  // Read the keys off the block itself: a key added there and not to the list
  // would be withheld from exactly the user whose own [agents] table refused it.
  const written = [...codexAgentDefaultsBlock().matchAll(/^([a-z_]+) = /gm)].map((m) => m[1]);
  assertEquals(written, [...CODEX_AGENTS_KEYS]);
  for (const key of written) assertStringIncludes(CODEX_CONFIG_REFUSAL.message, key);
});
