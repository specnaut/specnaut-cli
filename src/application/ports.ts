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

import type { BacklogTask } from "../domain/backlog/task.ts";
import type { ExistingIssue, SyncAction } from "../domain/backlog/sync_plan.ts";
import type { SyncConfig } from "../domain/sync_config.ts";

export interface BacklogReader {
  readAll(projectDir: string): Promise<BacklogTask[]>;
  readOne(projectDir: string, id: string): Promise<BacklogTask | null>;
}

export interface BacklogSyncTarget {
  listExisting(config: SyncConfig): Promise<Map<string, ExistingIssue>>;
  apply(action: SyncAction, config: SyncConfig): Promise<ApplyResult>;
}

export type ApplyResult =
  | { ok: true; issueNumber: number; action: SyncAction["kind"] }
  | { ok: false; error: string; action: SyncAction["kind"]; taskId: string };

export interface ConfigStore {
  read(projectDir: string): Promise<SyncConfig | null>;
  write(projectDir: string, config: SyncConfig): Promise<void>;
  configPath(projectDir: string): string;
}

export interface InteractivePrompt {
  select(
    message: string,
    choices: ReadonlyArray<{ label: string; value: string }>,
  ): Promise<string>;
  confirm(message: string, defaultYes: boolean): Promise<boolean>;
  text(message: string, defaultValue?: string): Promise<string>;
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

export interface Harness {
  readonly key: string;
  readonly displayName: string;
  mapBundle(core: CoreBundle): Bundle;
}
