import { assertEquals, assertThrows } from "@std/assert";
import {
  type HookTrust,
  hookTrustCovers,
  hookTrustDue,
  registeredHooks,
} from "../../src/domain/hook_trust.ts";
import { JsonMergeParseError } from "../../src/domain/hook_settings_merge.ts";
import { codexHookCommand } from "../../src/domain/hook_command.ts";

/**
 * Whether the trust note is due (plan § 5): a harness that hashes its hook
 * registrations runs none of them again until the user re-trusts, so `init` and
 * `upgrade` must say so whenever a run changed one of the paths it hashes —
 * and only then, or the note becomes a line people learn to skip.
 */

const TRUST: HookTrust = {
  paths: [".codex/hooks.json", ".specnaut/hooks/"],
  registry: ".codex/hooks.json",
  note: "trust them",
};

Deno.test("hookTrustDue: a changed registry file or a file in the hooks folder makes it due", () => {
  assertEquals(hookTrustDue(TRUST, [".codex/hooks.json"]), true);
  assertEquals(hookTrustDue(TRUST, ["AGENTS.md", ".specnaut/hooks/guard-merge.sh"]), true);
});

Deno.test("hookTrustDue: nothing under the hashed paths, or no trust at all, is never due", () => {
  assertEquals(hookTrustDue(TRUST, []), false);
  assertEquals(hookTrustDue(TRUST, ["AGENTS.md", ".specnaut/scripts/bash/common.sh"]), false);
  assertEquals(hookTrustDue(undefined, [".codex/hooks.json", ".specnaut/hooks/x.sh"]), false);
});

Deno.test("hookTrustCovers: a file path matches exactly, only a folder path matches a prefix", () => {
  assertEquals(hookTrustCovers(TRUST, ".codex/hooks.json.specnaut.bak"), false);
  assertEquals(hookTrustCovers(TRUST, ".specnaut/hooksmith.sh"), false);
  assertEquals(hookTrustCovers(TRUST, ".specnaut/hooks/SHA256SUMS"), true);
});

const registry = (hooks: Record<string, unknown>) => JSON.stringify({ hooks });
const entry = (command: string) => ({ type: "command", command });
const codex = (script: string, args = "codex") =>
  codexHookCommand({ script, args, onChanged: 2 }, "c".repeat(64));

Deno.test("registeredHooks: splits Specnaut's scripts, by name, from every other command", () => {
  const found = registeredHooks(
    registry({
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            entry(codex("guard-merge.sh")),
            entry("./tools/my-lint.sh"),
          ],
        },
        { matcher: "Agent", hooks: [entry(codex("guard-merge.sh", "x"))] },
      ],
      Stop: [{ hooks: [entry(codex("approve-on-prompt.sh"))] }],
    }),
    ".codex/hooks.json",
  );
  assertEquals(found.specnaut, ["approve-on-prompt.sh", "guard-merge.sh"]);
  assertEquals(found.foreign, ["./tools/my-lint.sh"]);
});

Deno.test("registeredHooks: a command that only mentions a Specnaut script is named as foreign", () => {
  // The user is about to trust it: listing it as Specnaut's would hide it.
  const wrapper = 'mycheck.sh && exec bash "$r/.specnaut/hooks/guard-merge.sh" codex';
  const found = registeredHooks(
    registry({ PreToolUse: [{ matcher: "Bash", hooks: [entry(wrapper)] }] }),
    ".codex/hooks.json",
  );
  assertEquals(found, { specnaut: [], foreign: [wrapper] });
});

Deno.test("registeredHooks: an absent file, no hooks, or an event that is not a list registers nothing", () => {
  assertEquals(registeredHooks(null, ".codex/hooks.json"), { specnaut: [], foreign: [] });
  assertEquals(registeredHooks("{}", ".codex/hooks.json"), { specnaut: [], foreign: [] });
  assertEquals(
    registeredHooks(registry({ Stop: { hooks: [entry("./x.sh")] } }), ".codex/hooks.json"),
    { specnaut: [], foreign: [] },
  );
});

Deno.test("registeredHooks: a file that does not parse says which file", () => {
  assertThrows(() => registeredHooks("{", ".codex/hooks.json"), JsonMergeParseError, "hooks.json");
});
