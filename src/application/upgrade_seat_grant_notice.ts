import type { FsReader } from "./ports.ts";
import { AGENT_FOLDERS, agentFile } from "../domain/agent_folders.ts";
import type { KnownHarness } from "../domain/installed_lock.ts";
import { wideGrant } from "../domain/seat_grant_wide.ts";

/**
 * One warning per product-owner definition, under any harness's agent folder,
 * that still grants a shell or a write tool after the run — a customised copy
 * upgrade kept, or a file a project wrote itself. The product owner now
 * proposes a plan and a bundled executor applies it, so a wider grant only
 * keeps tools the seat no longer needs; upgrade never rewrites a file the user
 * changed, so it says so instead.
 *
 * Read from disk once the run has written: a file this run replaced with the
 * shipped one is narrow by then. A dry run writes nothing, so it is not asked.
 */
export async function productOwnerGrantNotices(
  reader: FsReader,
  projectDir: string,
): Promise<string[]> {
  const out: string[] = [];
  for (const [harness, folder] of Object.entries(AGENT_FOLDERS)) {
    if (folder === null) continue;
    const path = agentFile(folder, "product-owner");
    const text = await reader.readText(projectDir, path);
    if (text === null) continue;
    const wide = wideGrant(harness as KnownHarness, text);
    if (wide.length === 0) continue;
    out.push(
      `${path} still grants ${wide.join(", ")} to the product owner, which now needs only ` +
        `Read, Grep and Glob: narrow its grant to the shipped one, or take the shipped file ` +
        `with \`specnaut upgrade --force\` (your copy is backed up)`,
    );
  }
  return out;
}
