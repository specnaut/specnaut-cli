export type CoreCategory =
  | "command"
  | "agent"
  | "skill"
  | "spec-root"
  | "project-root"
  | "backlog-cmd";

export type CoreEntry = {
  readonly category: CoreCategory;
  readonly name: string;
  readonly suffix: string | null;
  readonly content: string;
  readonly executable: boolean;
};

export type CoreBundle = ReadonlyArray<CoreEntry>;
