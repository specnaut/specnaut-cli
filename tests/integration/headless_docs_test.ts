import { assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

const root = fromFileUrl(new URL("../../", import.meta.url));
const read = (rel: string) => Deno.readTextFile(`${root}${rel}`);

Deno.test("headless-vm-mode doc exists and documents enablement + gate resolution", async () => {
  const doc = await read("docs/headless-vm-mode.md");
  assertStringIncludes(doc, "SPECFLOW_REMOTE"); // how to enable remote mode
  assertStringIncludes(doc, "specflow cloud login"); // auth prerequisite
  assertStringIncludes(doc, "specflow gate status"); // the remote-mode check
  assertStringIncludes(doc, "plan_approval"); // the plan checkpoint gate
  assertStringIncludes(doc, "merge_approval"); // the merge checkpoint gate
  assertStringIncludes(doc, "claude -p"); // an unattended launch path
});

Deno.test("auto-chain template carries guarded plan + merge approval branches", async () => {
  const chain = await read("templates/core/skills/specflow/phases/auto-chain.md");
  // both approval gates are wired, each behind a `specflow gate status` check
  assertStringIncludes(chain, "plan_approval");
  assertStringIncludes(chain, "merge_approval");
  assertStringIncludes(chain, "specflow gate status");
  // the local "Ready to merge?" prompt is preserved as the off-path fallback
  assertStringIncludes(chain, "Ready to merge?");
});
