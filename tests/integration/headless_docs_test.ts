import { assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

const root = fromFileUrl(new URL("../../", import.meta.url));
const read = (rel: string) => Deno.readTextFile(`${root}${rel}`);

Deno.test("auto-chain template carries guarded plan + merge approval branches", async () => {
  const chain = await read("templates/core/skills/specnaut/phases/auto-chain.md");
  // both approval gates are wired, each behind a `specnaut gate status` check
  assertStringIncludes(chain, "plan_approval");
  assertStringIncludes(chain, "merge_approval");
  assertStringIncludes(chain, "specnaut gate status");
  // the local "Ready to merge?" prompt is preserved as the off-path fallback
  assertStringIncludes(chain, "Ready to merge?");
});
