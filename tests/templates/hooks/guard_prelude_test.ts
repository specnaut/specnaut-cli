import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  bashPath,
  type Harness,
  HOOKS_DIR,
  makeRepo,
  payload,
  runHook,
  runScript,
  sandbox,
  stamps,
} from "./hook_sandbox.ts";
import { pathWithoutJq } from "./hook_path.ts";

/**
 * FR-015 — no guard can allow by failing. Both harnesses let a tool call
 * through on any exit other than 2, so every failure a guard can meet must
 * end in exit 2 with the reason on stderr. Exercised through each real guard,
 * not through `_guard.sh` alone: the prelude is only as good as the guards
 * that source it. The approval writer is the deliberate exception (exit 0):
 * an exit 2 there would block the user's own prompt.
 */

const GUARDS: ReadonlyArray<[hook: string, harness: Harness, fixture: string]> = [
  ["guard-merge.sh", "claude", "pre_tool_use_bash"],
  ["guard-merge.sh", "codex", "pre_tool_use_bash"],
  ["guard-release.sh", "codex", "pre_tool_use_bash"],
  ["guard-dispatch-model.sh", "claude", "pre_tool_use_agent"],
  ["guard-dispatch-model.sh", "codex", "pre_tool_use_spawn_agent"],
  ["protect-generated.sh", "claude", "pre_tool_use_edit"],
  ["protect-generated.sh", "codex", "pre_tool_use_apply_patch"],
  ["protect-constitution.sh", "claude", "pre_tool_use_edit"],
  ["protect-constitution.sh", "claude", "pre_tool_use_bash"],
  ["protect-constitution.sh", "codex", "pre_tool_use_apply_patch"],
  ["protect-constitution.sh", "codex", "pre_tool_use_bash"],
];

Deno.test("every guard exits 2 on bad JSON, an unknown shape, a missing jq or a missing harness", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { mode: "manual" });
    const noJq = await pathWithoutJq(sb);
    for (const [hook, harness, fixture] of GUARDS) {
      const good = await payload(harness, fixture, { cwd: repo });
      const label = `${hook} ${harness}`;

      const bad = await runHook(sb, hook, harness, "{not json");
      assertEquals(bad.code, 2, `${label}: bad JSON`);
      assertStringIncludes(bad.stderr, "specnaut");

      for (
        const shape of [[], "a string", { ...good, tool_input: "not an object" }, {
          ...good,
          cwd: 7,
        }]
      ) {
        const r = await runHook(sb, hook, harness, JSON.stringify(shape));
        assertEquals(r.code, 2, `${label}: unknown shape ${JSON.stringify(shape).slice(0, 60)}`);
      }

      const empty = await runHook(sb, hook, harness, "");
      assertEquals(empty.code, 2, `${label}: empty stdin`);
      assertStringIncludes(empty.stderr, "payload", `${label}: the refusal says why`);

      const r = await runHook(sb, hook, harness, good, { env: { PATH: noJq } });
      assertEquals(r.code, 2, `${label}: jq missing`);
      assertStringIncludes(r.stderr, "jq");

      for (const arg of ["", "cursor"]) {
        const h = await runHook(sb, hook, arg as Harness, good);
        assertEquals(h.code, 2, `${hook}: harness argument ${JSON.stringify(arg)}`);
      }
    }
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a shell error the ERR trap does not see (set -u) still exits 2, never 1", async () => {
  const sb = await sandbox();
  try {
    // `set -u` aborts with status 1 without running the ERR trap, and 1 means
    // "allow" to both harnesses. The EXIT net in _guard.sh turns it into 2.
    const script = join(sb.dir, "probe.sh");
    await Deno.writeTextFile(
      script,
      `. "${bashPath(join(HOOKS_DIR, "_guard.sh"))}"\necho "$NEVER_SET"\n`,
    );
    const r = await runScript(sb, script, sb.dir);
    assertEquals(r.code, 2, r.stderr);
    assertStringIncludes(r.stderr, "refusing");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("the approval writer fails closed by minting nothing, never by blocking the prompt", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb);
    const noJq = await pathWithoutJq(sb);
    for (const harness of ["claude", "codex"] as const) {
      // The fixture's prompt is `merge`: with jq and a good payload it mints.
      const good = await payload(harness, "user_prompt_submit", { cwd: repo });
      const failures: Array<[string, string | Record<string, unknown>, Record<string, string>]> = [
        ["bad JSON", "{not json", {}],
        ["empty stdin", "", {}],
        ["an array", "[]", {}],
        ["jq missing", good, { PATH: noJq }],
      ];
      for (const [label, input, env] of failures) {
        const r = await runHook(sb, "approve-on-prompt.sh", harness, input, { env });
        assertEquals(r.code, 0, `${harness} ${label}: exit`);
        assertEquals(await stamps(sb), [], `${harness} ${label}: minted a stamp`);
      }
    }
    // Positive control: the same store, read the same way, does see a minted
    // stamp — so the empty reads above are the writer refusing, not a blind probe.
    const good = await payload("codex", "user_prompt_submit", { cwd: repo });
    assertEquals((await runHook(sb, "approve-on-prompt.sh", "codex", good)).code, 0);
    assertEquals((await stamps(sb)).length, 1, "a good prompt mints exactly one stamp");
  } finally {
    await sb.cleanup();
  }
});
