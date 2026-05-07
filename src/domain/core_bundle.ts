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
};

export type CoreBundle = ReadonlyArray<CoreEntry>;
