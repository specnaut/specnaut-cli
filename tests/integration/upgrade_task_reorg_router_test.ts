import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { routerEndpointEntry, staleRouterAdvice } from "../../src/domain/skill_doc_renames.ts";
import { HARNESSES, projectOn71, runSpecnaut, withTempDir } from "./task_reorg_fixture.ts";

/**
 * Spec 037 — a customised `/specnaut` router from 7.1 is kept like every
 * customisation, and still routes to addresses that are gone: upgrade and
 * `check --project` both name it, and neither names an untouched one.
 */

for (const ai of HARNESSES) {
  Deno.test(`${ai}: a customised /specnaut router from 7.1 is named by upgrade and by check`, async () => {
    await withTempDir(async (dir) => {
      const { dest } = await projectOn71(dir, ai, { customiseRouter: true });
      const router = dest(routerEndpointEntry("specnaut"));

      const up = await runSpecnaut(["upgrade"], dir);
      assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);
      assertStringIncludes(up.stdout, `${router} ${staleRouterAdvice(router)}`);

      // Durable: still said after the upgrade, until the baseline is re-taken.
      const check = await runSpecnaut(["check", "--project"], dir);
      assertStringIncludes(check.stdout, router);
      assertStringIncludes(check.stdout, staleRouterAdvice(router));
    });
  });

  Deno.test(`${ai}: an untouched /specnaut router from 7.1 is not named`, async () => {
    await withTempDir(async (dir) => {
      const { dest } = await projectOn71(dir, ai);
      const advice = staleRouterAdvice(dest(routerEndpointEntry("specnaut")));
      const up = await runSpecnaut(["upgrade"], dir);
      assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);
      assert(!up.stdout.includes(advice), "an untouched router was reported as customised");
      const check = await runSpecnaut(["check", "--project"], dir);
      assert(!check.stdout.includes(advice), "check named an untouched router");
    });
  });
}
