import type { BacklogBackend } from "./installed_lock.ts";

export type CoreCategory =
  | "command"
  | "agent"
  | "agent-memory"
  | "skill"
  | "spec-root"
  | "project-root"
  | "backlog-cmd"
  | "backlog-skill"
  | "backlog-script"
  | "mergeable-project-root";

export type CoreEntry = {
  readonly category: CoreCategory;
  readonly name: string;
  readonly suffix: string | null;
  readonly content: string;
  readonly executable: boolean;
  /**
   * When set, the entry only applies if the chosen backlog backend matches.
   * Absent or `null` means the entry applies regardless of backend.
   */
  readonly backend?: BacklogBackend | null;
  /**
   * When `true`, the harness's `mapBundle` propagates this to the resulting
   * `TemplateFile.skipIfExists`. Used for placeholder files (`AGENTS.md`,
   * `.specflow/memory/constitution.md`) where the user's existing content
   * is always more useful than our empty template — see #119.
   */
  readonly skipIfExists?: boolean;
};

export type CoreBundle = ReadonlyArray<CoreEntry>;
