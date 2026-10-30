import { assert, assertEquals } from "@std/assert";
import { count, fixtureRepo, git, scope } from "./collect_audit_scope_fixture.ts";

/**
 * `TEST_COUNT` — the signal that decides whether `code-reviewer` runs its test
 * checklist during `/task review`. Behaviour cases for `collect-audit-scope.sh`;
 * the block shape and the other signals are in `collect_audit_scope_test.ts`.
 */

Deno.test("collect-audit-scope counts test files via TEST_COUNT", async () => {
  const dir = await fixtureRepo();
  try {
    await Deno.writeTextFile(`${dir}/src/button_test.ts`, "Deno.test('x', () => {});\n");
    await git(["add", "."], dir);
    await git(["commit", "-m", "test: add a test"], dir);
    const r = await scope(dir, ["--last", "5"]);
    assertEquals(r.code, 0, r.stderr);
    assert(count(r.stdout, "TEST_COUNT") >= 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/**
 * `TEST_COUNT` decides whether `code-reviewer` runs its test checklist during
 * `/task review`, so a project whose tests sit in a top-level `test/` (not
 * `tests/`, not `*_test.*`) must still count — otherwise its test changes are
 * reviewed by no checklist at all.
 */
Deno.test("collect-audit-scope counts a top-level test/ directory via TEST_COUNT", async () => {
  const dir = await fixtureRepo();
  try {
    await Deno.mkdir(`${dir}/test`, { recursive: true });
    await Deno.writeTextFile(`${dir}/test/button.ts`, "export const t = 1;\n");
    await git(["add", "."], dir);
    await git(["commit", "-m", "test: top-level test dir"], dir);
    const r = await scope(dir, ["--range", "HEAD~1..HEAD"]);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(count(r.stdout, "TEST_COUNT"), 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
