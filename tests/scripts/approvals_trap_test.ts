import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";
import { run } from "./git_hermetic.ts";

/**
 * cli#828: `_approvals.sh` is a sourced library, so the process's EXIT trap is its caller's.
 * Setting one itself would silently replace whatever trap the sourcing script had installed; it
 * exposes `approvals_cleanup` and `land-feature.sh` installs the trap (its cleanup is held by
 * `land_feature_approval_failures_test.ts`).
 */

const APPROVALS = bashPath(fromFileUrl(
  new URL("../../templates/core/specnaut/scripts/bash/_approvals.sh", import.meta.url),
));

Deno.test("recording approvals leaves the caller's EXIT trap in place", async () => {
  // A yes that held, and a binary that records nothing: record_approvals runs to its end.
  const script = `set -euo pipefail
trap 'echo "caller trap ran"' EXIT
. "$1"
me=test instructions_digest=abc last=HEAD base_tip=HEAD sn=true
out="APPROVAL instructions holds x"
record_approvals
echo "recorded"`;
  const r = await run("bash", ["-c", script, "_", APPROVALS], Deno.cwd());
  assertEquals(r.code, 0, r.stderr);
  assertEquals(r.stdout.trim().split("\n"), ["recorded", "caller trap ran"], r.stderr);
});
