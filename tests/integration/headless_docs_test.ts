import { assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

const root = fromFileUrl(new URL("../../", import.meta.url));
const read = (rel: string) => Deno.readTextFile(`${root}${rel}`);

Deno.test("auto-chain template carries guarded plan + merge approval branches", async () => {
  const chain = await read("templates/core/skills/task/phases/auto-chain.md");
  // The remote-mode check stays in auto-chain; the gates it loads live in remote-gates.md (spec 041).
  assertStringIncludes(chain, "specnaut gate status");
  assertStringIncludes(chain, "phases/remote-gates.md");
  const gates = await read("templates/core/skills/task/phases/remote-gates.md");
  assertStringIncludes(gates, "plan_approval");
  assertStringIncludes(gates, "merge_approval");
  // the local "Ready to merge?" prompt is preserved for `merge: manual`
  assertStringIncludes(chain, "Ready to merge?");
});
