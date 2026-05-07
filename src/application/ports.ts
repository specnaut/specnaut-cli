import type { Bundle } from "../domain/template.ts";
import type { Release } from "../domain/release.ts";
import type { CheckOutcome } from "../domain/check_result.ts";
import type { InstalledLock } from "../domain/installed_lock.ts";

export interface FsWriter {
  detectConflicts(bundle: Bundle, targetDir: string): Promise<string[]>;
  writeBundle(
    bundle: Bundle,
    targetDir: string,
    options: { overwrite?: boolean; backupExisting?: boolean },
  ): Promise<BackupReport>;
  deletePaths(
    paths: ReadonlyArray<string>,
    targetDir: string,
    options: { backupExisting: boolean },
  ): Promise<BackupReport>;
}

export type BackupReport = {
  readonly backups: ReadonlyArray<{ readonly dest: string; readonly backupPath: string }>;
};

export interface GitAdapter {
  isAvailable(): Promise<boolean>;
  isInitialized(dir: string): Promise<boolean>;
  init(dir: string): Promise<void>;
}

export interface ReleaseChecker {
  getLatest(): Promise<Release>;
}

export interface Downloader {
  download(url: string): Promise<Uint8Array>;
  downloadText(url: string): Promise<string>;
}

export interface SubprocessRunner {
  run(cmd: string, args: string[], opts?: SubprocessOptions): Promise<SubprocessResult>;
}

export type SubprocessOptions = {
  cwd?: string;
  stdin?: string;
  env?: Record<string, string>;
};

export type SubprocessResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export interface EnvironmentProbe {
  probeGit(): Promise<CheckOutcome>;
  probeGh(): Promise<CheckOutcome>;
  probeDeno(): Promise<CheckOutcome>;
}

export interface ProjectInspector {
  inspect(projectDir: string, templatesVersion: string): Promise<CheckOutcome[]>;
}

export interface LockStore {
  read(projectDir: string): Promise<InstalledLock | null>;
  write(projectDir: string, lock: InstalledLock): Promise<void>;
  lockPath(projectDir: string): string;
}

export interface FsReader {
  readText(projectDir: string, rel: string): Promise<string | null>;
}

import type { CoreBundle } from "../domain/core_bundle.ts";
import type { BacklogBackend } from "../domain/installed_lock.ts";

export type BundleOptions = {
  /**
   * Which backlog backend's conditional sections and scripts the harness
   * should keep. Entries tagged with a different backend are filtered out;
   * the bundled SKILL.md is rendered with the matching markers stripped.
   */
  readonly backlogBackend: BacklogBackend;
};

export interface Harness {
  readonly key: string;
  readonly displayName: string;
  mapBundle(core: CoreBundle, opts: BundleOptions): Bundle;
}
