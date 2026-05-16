import { resolve } from "@std/path";
import { bold, dim, green, red, yellow } from "@std/fmt/colors";
import { InitProjectUseCase } from "../../application/init_project.ts";
import { findHarness } from "../harnesses.ts";
import { type HarnessKey, pickHarness, pickHarnessInteractive } from "../harness_picker.ts";
import {
  pickBacklogBackend,
  pickBacklogBackendInteractive,
  promptKanbanURL,
} from "../backlog_picker.ts";
import {
  DEFAULT_VERSION_SCHEME,
  pickVersionScheme,
  pickVersionSchemeInteractive,
} from "../scheme_picker.ts";
import { makeStdinSelectIO } from "../select.ts";
import type { BacklogBackend, VersionScheme } from "../../domain/installed_lock.ts";
import { detectVersionScheme } from "../../domain/project_detection.ts";
import { findBacklogStrategy } from "../../domain/backlog_strategies/registry.ts";
import {
  type ParsedKanbanURL,
  parseKanbanURL,
} from "../../domain/backlog_strategies/kanban_url_parser.ts";
import { ClaudeSettingsParseError } from "../../domain/claude_settings_merge.ts";
import { DenoFsWriter } from "../../infrastructure/deno_fs_writer.ts";
import { DenoGit } from "../../infrastructure/deno_git.ts";
import { FsLockStore } from "../../infrastructure/fs_lock_store.ts";
import { CORE_BUNDLE } from "../../templates_bundle.ts";
import type { Bundle } from "../../domain/template.ts";

export type InitIntent = {
  kind: "init";
  projectName: string | null;
  here: boolean;
  noGit: boolean;
  ai: HarnessKey | null;
  backlog: BacklogBackend | null;
  /** Raw `--backlog-url` value; parsed in handler. */
  backlogUrl: string | null;
  /** Optional `--backlog-repo` override for the GitHub `repo` field. */
  backlogRepo: string | null;
  /** Explicit `--scheme` value (`semver` | `date`). Null = ask/detect. */
  scheme: VersionScheme | null;
  force: boolean;
};

async function resolveHarnessKey(
  explicit: HarnessKey | null,
): Promise<HarnessKey> {
  if (explicit !== null) return explicit;
  if (!Deno.stdin.isTerminal()) {
    return pickHarness({
      readLine: () => prompt("Choose [1-8]:"),
      log: (s) => console.log(s),
      errLog: (s) => console.error(red(s)),
    });
  }
  const picked = await pickHarnessInteractive(makeStdinSelectIO());
  if (picked === null) {
    console.error(red("aborted."));
    Deno.exit(130);
  }
  return picked;
}

async function resolveBacklogBackend(
  explicit: BacklogBackend | null,
): Promise<BacklogBackend> {
  if (explicit !== null) return explicit;
  if (!Deno.stdin.isTerminal()) {
    return pickBacklogBackend({
      readLine: () => prompt("Choose [1-3]:"),
      log: (s) => console.log(s),
      errLog: (s) => console.error(red(s)),
    });
  }
  const picked = await pickBacklogBackendInteractive(makeStdinSelectIO());
  if (picked === null) {
    console.error(red("aborted."));
    Deno.exit(130);
  }
  return picked;
}

/**
 * Detects whether the user's project looks like a library by probing
 * common manifest files at `targetDir`. The result is a soft suggestion
 * pre-positioning the picker cursor — the user always has the final
 * say via the prompt.
 */
function detectSchemeSuggestion(targetDir: string): VersionScheme {
  const result = detectVersionScheme({
    exists(rel) {
      try {
        Deno.statSync(`${targetDir}/${rel}`);
        return true;
      } catch {
        return false;
      }
    },
    readText(rel) {
      try {
        return Deno.readTextFileSync(`${targetDir}/${rel}`);
      } catch {
        return null;
      }
    },
    listTags() {
      // Stub: filled in by the follow-up commit that wires `git tag -l`
      // into the detection. Keeping the port contract satisfied here so
      // the rename commit type-checks on its own.
      return [];
    },
  });
  return result.suggestedScheme;
}

async function resolveVersionScheme(
  explicit: VersionScheme | null,
  suggestion: VersionScheme,
): Promise<VersionScheme> {
  if (explicit !== null) return explicit;
  if (!Deno.stdin.isTerminal()) {
    return pickVersionScheme(
      {
        readLine: () => prompt("Choose [1-2]:"),
        log: (s) => console.log(s),
        errLog: (s) => console.error(red(s)),
      },
      suggestion,
    );
  }
  const picked = await pickVersionSchemeInteractive(
    makeStdinSelectIO(),
    suggestion,
  );
  if (picked === null) {
    console.error(red("aborted."));
    Deno.exit(130);
  }
  return picked;
}

function printConflictsError(
  conflicts: string[],
  lockExists: boolean,
  totalManagedFiles: number,
): void {
  const n = conflicts.length;
  const noun = n === 1 ? "file" : "files";
  // Surface the gap between `wrote N files` (init success) and the
  // overwrite count when the two diverge. The difference is files
  // that are managed but never overwritten without --force —
  // skipIfExists placeholders like AGENTS.md and the constitution
  // template. Without this framing, a fresh user reads the two counts
  // as contradictory (#135).
  const owned = totalManagedFiles - n;
  const gapSuffix = owned > 0
    ? dim(
      ` (of ${totalManagedFiles} managed; ${owned} user-owned placeholder${
        owned === 1 ? "" : "s"
      } excluded — never overwritten without --force)`,
    )
    : "";
  console.error(red(`error: ${n} ${noun} would be overwritten${gapSuffix}:`));
  for (const c of conflicts) console.error(red(`  - ${c}`));
  console.error("");
  if (lockExists) {
    console.error(
      `This project was previously initialised by Specflow — run ${
        bold("specflow upgrade")
      } to update the managed files in place,`,
    );
    console.error(
      `or re-run with ${
        bold("specflow init --here --force")
      } to overwrite (existing files are backed up to *.specflow.bak).`,
    );
  } else {
    console.error(
      `Re-run with ${bold("specflow init --here --force")} to overwrite ` +
        "(existing files are backed up to *.specflow.bak).",
    );
  }
}

/**
 * Number of managed files emitted by the bundle — i.e. everything
 * `init` reports as `wrote N files`. Excludes mergeable files (counted
 * separately in the merged-paths suffix). Includes both writeable and
 * `skipIfExists` placeholder entries: the latter are part of the
 * managed set, just immune to overwrite without `--force`.
 *
 * Used to surface the gap between the success and conflict messages
 * in `printConflictsError` (#135).
 */
function countManagedFiles(bundle: Bundle): number {
  let count = 0;
  for (const file of Object.values(bundle)) {
    if (file.mergeBlock !== undefined) continue;
    if (file.mergeJson !== undefined) continue;
    count++;
  }
  return count;
}

async function writeBacklogConfigStub(
  targetDir: string,
  backend: BacklogBackend,
  url: ParsedKanbanURL | null,
  repo: string | null,
): Promise<void> {
  const strategy = findBacklogStrategy(backend);
  const ctx = {
    ...(url !== null ? { url } : {}),
    ...(repo !== null ? { repo } : {}),
  };
  const stub = strategy.initConfigStub(ctx);
  if (stub === null) return; // local: zero-config, nothing to write

  const path = `${targetDir}/.specflow/backlog-config.yml`;
  try {
    await Deno.stat(path);
    return; // don't clobber an existing config
  } catch {
    // not present → write the stub
  }
  await Deno.mkdir(`${targetDir}/.specflow`, { recursive: true });
  await Deno.writeTextFile(path, stub);
  for (const msg of strategy.initConfigMessages(ctx)) {
    console.log(dim(msg));
  }
}

/**
 * Parses `<owner>/<name>` out of a git remote URL. Handles both
 * `https://github.com/owner/repo(.git)` and `git@github.com:owner/repo(.git)`
 * shapes. Returns `null` for any other host or malformed input — the
 * caller falls back to the empty-stub path.
 */
function parseGithubRepoFromRemote(remote: string): string | null {
  // SSH: git@github.com:owner/repo(.git)
  const ssh = remote.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (ssh) return `${ssh[1]}/${ssh[2]}`;
  try {
    const u = new URL(remote);
    if (u.host !== "github.com") return null;
    const segs = u.pathname.split("/").filter((s) => s.length > 0);
    if (segs.length < 2) return null;
    const owner = segs[0];
    const repo = segs[1].replace(/\.git$/, "");
    if (!owner || !repo) return null;
    return `${owner}/${repo}`;
  } catch {
    return null;
  }
}

/**
 * Resolves the parsed Kanban URL for a remote backlog backend.
 *
 *   - `local` always returns `null` — no URL needed.
 *   - Non-local + explicit `intent.backlogUrl` → parse it; on failure,
 *     print an error and return `null` (handler decides whether to
 *     abort or fall through to empty stub).
 *   - Non-local + TTY → prompt interactively (max 3 retries).
 *   - Non-local + non-TTY + no flag → print an actionable error and
 *     return `null` (handler aborts with exit 2).
 */
function resolveKanbanURL(
  backend: BacklogBackend,
  rawUrlFlag: string | null,
): { ok: true; url: ParsedKanbanURL | null } | { ok: false; reason: string } {
  if (backend === "local") return { ok: true, url: null };
  if (rawUrlFlag !== null) {
    const parsed = parseKanbanURL(rawUrlFlag);
    if (parsed === null) {
      return {
        ok: false,
        reason: `--backlog-url "${rawUrlFlag}" is not a recognised project URL ` +
          `(expected https://github.com/orgs/<org>/projects/<N> for github, ` +
          `or https://<host>/<group>/<project> for gitlab)`,
      };
    }
    if (parsed.kind !== backend) {
      return {
        ok: false,
        reason: `--backlog-url is a ${parsed.kind} URL but --backlog is ${backend}`,
      };
    }
    return { ok: true, url: parsed };
  }
  if (Deno.stdin.isTerminal()) {
    const url = promptKanbanURL(backend as "github" | "gitlab", {
      readLine: () => prompt(""),
      log: (s) => console.log(s),
      errLog: (s) => console.error(red(s)),
    });
    return { ok: true, url };
  }
  return {
    ok: false,
    reason: `--backlog ${backend} requires --backlog-url <project-url> in non-interactive mode`,
  };
}

export async function runInit(intent: InitIntent): Promise<number> {
  const cwd = Deno.cwd();

  let targetDir: string;
  if (intent.here) {
    targetDir = cwd;
  } else if (intent.projectName) {
    targetDir = resolve(cwd, intent.projectName);
  } else {
    console.error(red("error: `specflow init` requires a project name or --here"));
    return 2;
  }

  const aiKey = await resolveHarnessKey(intent.ai);
  const harness = findHarness(aiKey);
  if (!harness) {
    console.error(red(`error: unknown harness '${aiKey}'`));
    return 2;
  }

  // Pre-flight conflict check — runs BEFORE the backlog-backend picker so
  // a doomed init doesn't drag the user through a prompt for nothing
  // (regression #103). The probe-bundle uses the `local` backend as a
  // placeholder: only `backlog-script` paths differ between backends, so
  // any existing managed file (CLAUDE.md, settings.json, SKILL.md, …)
  // shows up in every backend's bundle and is enough to flag the conflict
  // here. The use case still re-checks after the real backend is picked,
  // so the path stays correct even if the probe missed something.
  if (!intent.force) {
    const writer = new DenoFsWriter();
    const lockStore = new FsLockStore();
    const probeBundle = harness.mapBundle(CORE_BUNDLE, {
      backlogBackend: "local",
      versionScheme: DEFAULT_VERSION_SCHEME,
    });
    const conflicts = await writer.detectConflicts(probeBundle, targetDir);
    if (conflicts.length > 0) {
      const lock = await lockStore.read(targetDir);
      const totalManaged = countManagedFiles(probeBundle);
      printConflictsError(conflicts, lock !== null, totalManaged);
      return 3;
    }
  }

  const backlogBackend = await resolveBacklogBackend(intent.backlog);
  const schemeSuggestion = detectSchemeSuggestion(targetDir);
  const versionScheme = await resolveVersionScheme(
    intent.scheme,
    schemeSuggestion,
  );

  // Capture the Kanban URL up front (interactive prompt or --backlog-url
  // flag) so the populated config lands at init time and the PO never
  // re-asks during `groom` / other backlog dispatches.
  const urlResolution = resolveKanbanURL(backlogBackend, intent.backlogUrl);
  if (!urlResolution.ok) {
    console.error(red(`error: ${urlResolution.reason}`));
    return 2;
  }
  const kanbanUrl = urlResolution.url;

  // For GitHub: derive the `repo` field. Priority:
  //   1. --backlog-repo flag (explicit override)
  //   2. git remote get-url origin (parsed for owner/name)
  //   3. null → empty stub fallback
  let githubRepo: string | null = null;
  if (backlogBackend === "github" && kanbanUrl !== null) {
    if (intent.backlogRepo !== null) {
      githubRepo = intent.backlogRepo;
    } else {
      const git = new DenoGit();
      const remote = await git.getRemoteUrl(targetDir, "origin");
      githubRepo = remote !== null ? parseGithubRepoFromRemote(remote) : null;
    }
  }

  console.log(`Initializing into ${bold(targetDir)}`);

  const useCase = new InitProjectUseCase({
    writer: new DenoFsWriter(),
    git: new DenoGit(),
    lockStore: new FsLockStore(),
    harness,
    backlogBackend,
    versionScheme,
    core: CORE_BUNDLE,
    ensureDir: (path) => Deno.mkdir(path, { recursive: true }),
  });

  let result;
  try {
    result = await useCase.execute({
      targetDir,
      initGit: !intent.noGit,
      force: intent.force,
    });
  } catch (err) {
    // Surface the actionable first-line message for known structured
    // errors (currently only the JSON merge of `.claude/settings.json`).
    // Without this catch, Deno's default top-level handler prints a
    // 10-line stack trace from inside the compiled binary's cache —
    // unprofessional and noisy for what is a user-fixable typo.
    if (err instanceof ClaudeSettingsParseError) {
      console.error(red(err.message));
      return 2;
    }
    throw err;
  }

  if (result.status === "conflicts") {
    // Re-derive the managed file count for the secondary conflict path
    // (use-case detection). Bundle is the same shape as the probe; the
    // backlog backend chosen here may differ from the probe's "local"
    // default, but the managed count is invariant — backlog-script
    // entries are present regardless of backend.
    const probeBundle = harness.mapBundle(CORE_BUNDLE, {
      backlogBackend,
      versionScheme,
    });
    const totalManaged = countManagedFiles(probeBundle);
    printConflictsError(result.conflicts, result.lockExists, totalManaged);
    return 3;
  }

  for (const w of result.warnings) console.error(yellow(`warn: ${w}`));
  for (const b of result.backups) console.log(dim(`↳ backed up ${b} → ${b}.specflow.bak`));
  const mergedSuffix = result.filesMerged.length > 0
    ? ` (+ merged: ${result.filesMerged.join(", ")})`
    : "";
  console.log(green(`✓ wrote ${result.filesWritten} files${mergedSuffix}`));

  await writeBacklogConfigStub(targetDir, backlogBackend, kanbanUrl, githubRepo);
  console.log("\nNext steps:");
  console.log(
    `  1. Open the project in ${harness.displayName}, then run ${
      bold("/specflow constitution")
    } to scaffold your project's guiding principles`,
  );
  console.log(
    `  2. Edit ${bold("AGENTS.md")} and refine ${
      bold(".specflow/memory/constitution.md")
    } for your stack`,
  );
  console.log(
    `  3. Run ${bold('/specflow specify "<feature description>"')} to scaffold your first feature`,
  );
  console.log(`  4. Use ${bold('/backlog add "<task title>"')} for follow-up work`);
  return 0;
}
