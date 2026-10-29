import { assertEquals } from "@std/assert";
import { ownershipFields } from "../../../src/infrastructure/harness/harness_managed.ts";
import type { CoreEntry } from "../../../src/domain/core_bundle.ts";

/**
 * The one mapping of a manifest entry's ownership flags (spec 038, A-M6): the
 * manifest carries `projectOwned` alone, and it implies `skipIfExists` — a
 * file Specnaut never rewrites is a file it writes only where nothing is.
 */

const entry = (flags: Partial<CoreEntry>): CoreEntry => ({
  category: "project-root",
  name: "root",
  suffix: "x.md",
  content: "",
  executable: false,
  ...flags,
});

Deno.test("projectOwned implies skipIfExists", () => {
  assertEquals(ownershipFields(entry({ projectOwned: true })), {
    skipIfExists: true,
    projectOwned: true,
  });
});

Deno.test("skipIfExists alone stays a placeholder", () => {
  assertEquals(ownershipFields(entry({ skipIfExists: true })), { skipIfExists: true });
});

Deno.test("neither flag maps to nothing", () => {
  assertEquals(ownershipFields(entry({})), {});
  assertEquals(ownershipFields(entry({ skipIfExists: false })), {});
});
