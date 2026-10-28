import { assertEquals, assertStringIncludes } from "@std/assert";
import { pruneStaging } from "../../src/application/upgrade_staging.ts";
import { fakeStagingStore } from "./upgrade_fakes.ts";

Deno.test("a staging cleanup that fails is reported, not swallowed", async () => {
  const store = fakeStagingStore();
  store.cleanupIfEmpty = () => Promise.reject(new Error("EBUSY: resource busy"));
  const refusals: string[] = [];
  await pruneStaging(store, "/p", new Set(), refusals);
  assertEquals(refusals.length, 1);
  assertStringIncludes(refusals[0], "EBUSY: resource busy");
  assertStringIncludes(refusals[0], ".specnaut/upgrade-staging/");
});
