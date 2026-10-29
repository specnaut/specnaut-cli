import type { FsReader } from "./ports.ts";

/**
 * Where the phase docs used to look for extension hooks (`hooks.before_plan`
 * and the like). No release read it in code: the phases did, in prose, and
 * spec 041 removed those blocks. A project that wrote one would otherwise lose
 * its hook with nothing said.
 */
export const RETIRED_EXTENSIONS_PATH = ".specnaut/extensions.yml";

/** What upgrade says about project files a retired mechanism used to read. */
export async function retiredConfigNotices(
  reader: FsReader,
  projectDir: string,
): Promise<string[]> {
  if ((await reader.readEntry(projectDir, RETIRED_EXTENSIONS_PATH)) === null) return [];
  return [
    `${RETIRED_EXTENSIONS_PATH} is no longer read — the /task phases dropped their extension ` +
    `hooks. Move each hook into the phase's addendum, .specnaut/addenda/task/<phase>.md`,
  ];
}
