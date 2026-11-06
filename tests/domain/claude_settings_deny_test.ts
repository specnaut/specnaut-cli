import { assertEquals } from "@std/assert";
import { mergeClaudeSettings } from "../../src/domain/claude_settings_merge.ts";

/**
 * The credential read-deny rules Specnaut ships in `.claude/settings.json` join
 * the user's own `permissions.deny` as a set union: theirs stay, in order, and
 * none is ever dropped or rewritten. A seat's Read reaches outside the project
 * without a prompt, so these rules are what keep it off the credential files.
 */

const OURS = ["Read(~/.config/gh/**)", "Read(**/.env)"];
const BUNDLED = JSON.stringify({ permissions: { deny: OURS } });
const merge = (user: unknown) =>
  JSON.parse(mergeClaudeSettings(JSON.stringify(user), BUNDLED, ".claude/settings.json").content);

Deno.test("deny: a user file with no permissions gains the bundled rules", () => {
  assertEquals(merge({ theme: "dark" }).permissions, { deny: OURS });
});

Deno.test("deny: the user's rules stay first and in order; a shared rule is not doubled", () => {
  const user = { permissions: { allow: ["Bash(ls)"], deny: ["Bash(rm *)", "Read(**/.env)"] } };
  assertEquals(merge(user).permissions, {
    allow: ["Bash(ls)"],
    deny: ["Bash(rm *)", "Read(**/.env)", "Read(~/.config/gh/**)"],
  });
});

Deno.test("deny: the user's ask rules and other permission keys pass through", () => {
  const user = { permissions: { ask: ["Bash(git push *)"], defaultMode: "plan" } };
  assertEquals(merge(user).permissions, {
    ask: ["Bash(git push *)"],
    defaultMode: "plan",
    deny: OURS,
  });
});
