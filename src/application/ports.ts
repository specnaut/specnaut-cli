import type { Bundle } from "../domain/template.ts";

export interface FsWriter {
  detectConflicts(bundle: Bundle, targetDir: string): Promise<string[]>;
  writeBundle(
    bundle: Bundle,
    targetDir: string,
    options: { overwrite?: boolean },
  ): Promise<void>;
}

export interface GitAdapter {
  isAvailable(): Promise<boolean>;
  isInitialized(dir: string): Promise<boolean>;
  init(dir: string): Promise<void>;
}
