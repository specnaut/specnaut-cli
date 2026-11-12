import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { GitObjectReader } from "../../src/application/script_trust_ports.ts";
import { verifyCheckout } from "../../src/application/verify_checkout.ts";
import { findHarness } from "../../src/cli/harnesses.ts";
import { CHECKOUT_REASON, RESTART_ADVICE } from "../../src/domain/checkout_trust.ts";
import { REASON } from "../../src/domain/script_trust.ts";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { check, reasons, SETTINGS, setUp } from "./verify_checkout_fixture.ts";
import { commitAll, git, GIT_READ, write } from "./verify_scripts_fixture.ts";

/**
 * The checkout precondition through its real adapters, on real repositories: a base on origin, a
 * branch from outside fetched as objects only, and the user's checkout at the base.
 */

Deno.test("a clean checkout at the base holds, and names the tip it was measured against", async () => {
  const { root, head } = await setUp();
  const outcome = await check(root, head);
  const tip = (await git(root, "rev-parse", "main")).trim();
  assertEquals(outcome, { kind: "trusted", baseTip: tip });
});

Deno.test("a checkout holding a commit of the outside branch fails, naming it", async () => {
  const { root, head } = await setUp();
  await git(root, "merge", "-q", "--ff-only", "outside");
  const outcome = await check(root, head);
  assertEquals(outcome.kind, "restart");
  assertEquals(reasons(outcome), [{ path: head, reason: CHECKOUT_REASON.headHolds }]);
  if (outcome.kind === "restart") assertEquals(outcome.advice, RESTART_ADVICE);
});

Deno.test("a checkout with a commit of its own fails, even leaving every checked file alone", async () => {
  const { root, head } = await setUp();
  await write(root, { "src/b.ts": "export const b = 2;\n" });
  await commitAll(root, "own work");
  const own = (await git(root, "rev-parse", "HEAD")).trim();
  assertEquals(reasons(await check(root, head)), [{
    path: own,
    reason: CHECKOUT_REASON.headAhead,
  }]);
});

Deno.test("a checkout behind the base's tip holds the rule on commits", async () => {
  const { root, head } = await setUp();
  await git(root, "checkout", "-q", "main");
  await write(root, { "src/c.ts": "export const c = 3;\n" });
  await commitAll(root, "base moves");
  await git(root, "push", "-q", "origin", "main");
  await git(root, "checkout", "-q", "feature");
  assertEquals((await check(root, head)).kind, "trusted");
});

Deno.test("an edited helper script fails, with the script check's reason", async () => {
  const { root, head } = await setUp();
  await write(root, { [GIT_READ]: "echo edited\n" });
  assertEquals(reasons(await check(root, head)), [{ path: GIT_READ, reason: REASON.differs }]);
});

Deno.test("an edited harness setting fails, committed or not", async () => {
  const { root, head } = await setUp();
  await write(root, { [SETTINGS]: '{"hooks":{}}\n' });
  assertEquals(reasons(await check(root, head)), [{ path: SETTINGS, reason: REASON.differs }]);
  await commitAll(root, "settings");
  const own = (await git(root, "rev-parse", "HEAD")).trim();
  assertEquals(reasons(await check(root, head)), [
    { path: own, reason: CHECKOUT_REASON.headAhead },
    { path: SETTINGS, reason: REASON.differs },
  ]);
});

Deno.test("an extra file fails, an ignored one included: local settings, a version manager, a feature", async () => {
  const { root, head } = await setUp();
  const extra = [".claude/settings.local.json", ".mise.toml", ".specnaut/feature.json"];
  await write(root, Object.fromEntries(extra.map((p) => [p, "{}\n"])));
  const found = reasons(await check(root, head)).toSorted((a, b) => a.path < b.path ? -1 : 1);
  assertEquals(found, extra.map((path) => ({ path, reason: REASON.notOnBase })));
});

Deno.test("a nested repository among the checked files fails as one entry, its files unread", async () => {
  const { root, head } = await setUp();
  await write(root, {
    ".claude/worktrees/x/.git": "gitdir: elsewhere\n",
    ".claude/worktrees/x/a": "",
  });
  const found = reasons(await check(root, head));
  assertEquals(found, [{ path: ".claude/worktrees/x", reason: REASON.notRegular }]);
});

Deno.test("a deleted instruction file fails", async () => {
  const { root, head } = await setUp();
  await Deno.remove(join(root, "AGENTS.md"));
  assertEquals(reasons(await check(root, head)), [{ path: "AGENTS.md", reason: REASON.missing }]);
});

Deno.test("files outside the checked ones change nothing", async () => {
  const { root, head } = await setUp();
  await write(root, { "README.md": "notes\n", ".specnaut/specs/001-x/plan.md": "# plan\n" });
  assertEquals((await check(root, head)).kind, "trusted");
});

Deno.test("an outside head that is not a full sha, or names no commit here, fails before git reads it", async () => {
  const { root } = await setUp();
  const cases: [string, string][] = [
    ["--output=/tmp/x", "not a full commit sha"],
    ["HEAD", "not a full commit sha"],
    ["a".repeat(40), "names no commit in this repository: fetch it first"],
  ];
  for (const [head, reason] of cases) {
    assertEquals(reasons(await check(root, head)), [{ path: "head", reason }], head);
  }
});

Deno.test("an unknown base fails, never a check measured against nothing", async () => {
  const none = () => Promise.resolve(null);
  const git = { projectPrefix: "", originHead: none, globalDefaultBranch: none };
  const outcome = await verifyCheckout({
    git: git as unknown as GitObjectReader,
    walker: { walk: () => Promise.reject(new Error("not reached")) },
    checkout: { walk: () => Promise.reject(new Error("not reached")) },
    core: CORE_BUNDLE,
    findHarness,
  }, "c".repeat(40));
  assertEquals(reasons(outcome), [{
    path: "base",
    reason: "the base is unknown: no origin/HEAD and no global init.defaultBranch",
  }]);
});
