import type { KnownHarness } from "./installed_lock.ts";

/**
 * The folder a harness reads its agents from, one file per agent.
 *
 * `prefix` is what Specnaut puts before an agent's name in that folder; the
 * folder itself is shared with the project's own agents, which carry no prefix,
 * so a reader of the user's files goes by `dir` and `ext` alone.
 */
export interface AgentFolder {
  readonly dir: string;
  readonly ext: string;
  readonly prefix: string;
}

/**
 * Where each harness keeps its agents — the one spelling of those paths.
 *
 * The adapters write here, and upgrade reads the user's own files here for a
 * retired agent they still dispatch; two copies of the list drifted apart once
 * already (cli#712). `null` is a harness with no agent folder: Cursor and
 * Copilot receive each agent as a skill or an instruction file instead. A new
 * harness has to answer here, because the record is total over `KnownHarness`.
 */
export const AGENT_FOLDERS = {
  claude: { dir: ".claude/agents", ext: ".md", prefix: "" },
  cursor: null,
  codex: { dir: ".codex/agents", ext: ".toml", prefix: "" },
  copilot: null,
  opencode: { dir: ".opencode/agents", ext: ".md", prefix: "specnaut-" },
  antigravity: { dir: ".agents/agents", ext: ".md", prefix: "specnaut-" },
} as const satisfies Readonly<Record<KnownHarness, AgentFolder | null>>;

/** The file Specnaut writes for the agent `name` in `folder`. */
export const agentFile = (folder: AgentFolder, name: string): string =>
  `${folder.dir}/${folder.prefix}${name}${folder.ext}`;
