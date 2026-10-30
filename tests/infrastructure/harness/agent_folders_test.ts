import { assert, assertEquals } from "@std/assert";
import { HARNESSES } from "../../../src/cli/harnesses.ts";
import { everyBundleOption } from "../../../src/application/bundle_options.ts";
import { CORE_BUNDLE } from "../../../src/templates_bundle.ts";
import { AGENT_FOLDERS, agentFile } from "../../../src/domain/agent_folders.ts";
import type { KnownHarness } from "../../../src/domain/installed_lock.ts";

/**
 * `AGENT_FOLDERS` is the one spelling of where each harness keeps its agents
 * (cli#712), so it must say where the adapters actually write them — read off
 * `mapBundle`, not off a second list. A folder declared here that an adapter
 * does not write to would send upgrade's retired-agent notice to read the
 * wrong place, and say nothing.
 */

const AGENTS = CORE_BUNDLE.filter((e) => e.category === "agent").map((e) => e.name);
const OPTS = everyBundleOption()[0];

for (const harness of HARNESSES) {
  const folder = AGENT_FOLDERS[harness.key as KnownHarness];
  const dests = Object.keys(harness.mapBundle(CORE_BUNDLE, OPTS));

  Deno.test(`${harness.key}: its agents land where AGENT_FOLDERS says`, () => {
    assert(AGENTS.length > 5, `only ${AGENTS.length} agents in the bundle`);
    if (folder === null) {
      const stray = dests.filter((d) => /(^|\/)agents\//.test(d));
      assertEquals(stray, [], `${harness.key} declares no agent folder but writes one`);
      return;
    }
    assertEquals(
      AGENTS.map((n) => agentFile(folder, n)).filter((p) => !dests.includes(p)),
      [],
      `${harness.key} does not write its agents at AGENT_FOLDERS.${harness.key}`,
    );
  });
}
