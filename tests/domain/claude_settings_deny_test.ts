import { assert, assertEquals } from "@std/assert";
import { globToRegExp } from "@std/path";
import { mergeClaudeSettings } from "../../src/domain/claude_settings_merge.ts";

/**
 * The credential read-deny rules Specnaut ships in `.claude/settings.json` join
 * the user's own `permissions.deny` as a set union: theirs stay, in order, and
 * none is ever dropped or rewritten. A seat's Read reaches outside the project
 * with no approval step, so these rules keep it off credential reads no seat needs.
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

/** The shipped rules cover the credential and secret `.env` files only. */
const SHIPPED = JSON.parse(
  Deno.readTextFileSync(
    new URL("../../templates/harness-specific/claude/settings.json", import.meta.url),
  ),
).permissions.deny as string[];
const readGlobs = SHIPPED.map((r) => r.replace(/^Read\((.*)\)$/, "$1"));
const denied = (path: string) =>
  readGlobs.some((g) => globToRegExp(g, { globstar: true, extended: false }).test(path));

Deno.test("deny: the shipped settings deny exactly the credential and secret env reads", () => {
  assertEquals(SHIPPED, [
    "Read(~/.config/gh/**)",
    "Read(~/.config/glab-cli/**)",
    "Read(~/.specnaut/credentials*)",
    "Read(**/.env)",
    "Read(**/.env.local)",
    "Read(**/.env.*.local)",
    "Read(**/.env.production)",
  ]);
});

Deno.test("deny: the GitHub and GitLab CLIs' credential directories are denied", () => {
  for (const p of ["~/.config/gh/hosts.yml", "~/.config/glab-cli/config.yml"]) {
    assert(denied(p), `${p} should be denied`);
  }
  assert(!denied("~/.config/other/config.yml"), "another tool's config stays readable");
});

Deno.test("deny: a secret env file is denied, a committed template env file stays readable", () => {
  for (const p of ["app/.env", "app/.env.local", "app/.env.test.local", "app/.env.production"]) {
    assert(denied(p), `${p} should be denied`);
  }
  for (const p of ["app/.env.example", "app/.env.sample", "app/.env.test", "app/.envrc"]) {
    assert(!denied(p), `${p} should stay readable`);
  }
});
