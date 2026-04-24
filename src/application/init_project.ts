import type { Bundle } from "../domain/template.ts";
import type { FsWriter, GitAdapter } from "./ports.ts";

export type InitResult =
  | { status: "initialized"; filesWritten: number; warnings: string[] }
  | { status: "conflicts"; conflicts: string[] };

export type InitProjectDeps = {
  writer: FsWriter;
  git: GitAdapter;
  bundle: Bundle;
  /** Creates the target directory if it does not exist (idempotent). */
  ensureDir(path: string): Promise<void>;
};

export type InitProjectInput = {
  targetDir: string;
  initGit: boolean;
};

export class InitProjectUseCase {
  constructor(private readonly deps: InitProjectDeps) {}

  async execute(input: InitProjectInput): Promise<InitResult> {
    const { writer, git, bundle, ensureDir } = this.deps;
    const warnings: string[] = [];

    await ensureDir(input.targetDir);

    const conflicts = await writer.detectConflicts(bundle, input.targetDir);
    if (conflicts.length > 0) {
      return { status: "conflicts", conflicts };
    }

    await writer.writeBundle(bundle, input.targetDir, { overwrite: false });

    if (input.initGit) {
      const available = await git.isAvailable();
      if (!available) {
        warnings.push("git not found on PATH — skipping git init");
      } else {
        const already = await git.isInitialized(input.targetDir);
        if (!already) {
          try {
            await git.init(input.targetDir);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            warnings.push(`git init failed — ${msg}`);
          }
        }
      }
    }

    return {
      status: "initialized",
      filesWritten: Object.keys(bundle).length,
      warnings,
    };
  }
}
