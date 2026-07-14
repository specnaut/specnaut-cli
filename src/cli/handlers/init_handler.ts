import { resolve } from "@std/path";
import { bold, cyan, dim, green, red, yellow } from "@std/fmt/colors";
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
import {
  pickSpecBackend,
  pickSpecBackendInteractive,
} from "../spec_picker.ts";
import { makeStdinSelectIO } from "../select.ts";
import type { BacklogBackend, SpecBackend, VersionScheme } from "../../domain/installed_lock.ts";
import { SPEC_STRATEGIES } from "../../domain/spec_strategies/registry.ts";
import { detectVersionScheme } from "../../domain/project_detection.ts";
import {
  BACKLOG_STRATEGIES,
  findBacklogStrategy,
} from "../../domain/backlog_strategies/registry.ts";
import {
  type ParsedKanbanURL,
  parseKanbanURL,
} from "../../domain/backlog_strategies/kanban_url_parser.ts";
import { ClaudeSettingsParseError } from "../../domain/claude_settings_merge.ts";
import { DenoFsWriter } from "../../infrastructure/deno_fs_writer.ts";
import { DenoGit } from "../../infrastructure/deno_git.ts";
import { FsLockStore } from "../../infrastructure/fs_lock_store.ts";
import { migrateLegacyConfigDir } from "../../infrastructure/fs_legacy_migrator.ts";
import { FsParentWorkspaceReader } from "../../infrastructure/fs_parent_workspace_reader.ts";
import { FsPreserveStore } from "../../infrastructure/fs_preserve_store.ts";
import { isAgenticPath, isParentManaged } from "../../domain/parent_managed.ts";
import { resolvePreserveDeclarations } from "./preserve_resolution.ts";
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
  /**
   * Explicit `--spec-backend` value (`local` | `cloud`). Null triggers the
   * interactive picker (TTY) or the recommended default (non-TTY). Spec 020.
   */
  specBackend: SpecBackend | null;
  force: boolean;
  /**
   * `--dry-run`. Compute the plan and print it without writing anywhere
   * on disk — trumps `--force` (no overwrites, no backups, no lock).
   */
  dryRun: boolean;
  /**
   * `--reset-preserved`. Explicit, non-default opt-out (spec 011 / issue
   * #367): override every preserve declaration for THIS run, restoring the
   * bundled versions. The handler passes an empty preserved set and emits a
   * per-file override warning (FR-005). Never the default.
   */
  resetPreserved: boolean;
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
      readLine: () => prompt(`Choose [1-${BACKLOG_STRATEGIES.length}]:`),
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
 * Resolves the spec backend: explicit `--spec-backend` flag wins; otherwise the
 * interactive picker (TTY) or the non-TTY numeric prompt fall back to the
 * recommended default (spec 020, FR-001). Mirrors {@link resolveBacklogBackend}.
 */
async function resolveSpecBackend(
  explicit: SpecBackend | null,
): Promise<SpecBackend> {
  if (explicit !== null) return explicit;
  if (!Deno.stdin.isTerminal()) {
    return pickSpecBackend({
      readLine: () => prompt(`Choose [1-${SPEC_STRATEGIES.length}]:`),
      log: (s) => console.log(s),
      errLog: (s) => console.error(red(s)),
    });
  }
  const picked = await pickSpecBackendInteractive(makeStdinSelectIO());
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
      // `git tag -l` is the cheapest read: a few KB of stdout for the
      // largest repos, no network. If anything fails (no git binary, no
      // .git dir, command errors), return an empty list — the detector
      // treats absence as "no signal", not a failure.
      try {
        const out = new Deno.Command("git", {
          args: ["tag", "-l"],
          cwd: targetDir,
          stdout: "piped",
          stderr: "null",
        }).outputSync();
        if (!out.success) return [];
        return new TextDecoder()
          .decode(out.stdout)
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      } catch {
        return [];
      }
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
      `This project was previously initialised by Specnaut — run ${
        bold("specnaut upgrade")
      } to update the managed files in place,`,
    );
    console.error(
      `or re-run with ${
        bold("specnaut init --here --force")
      } to overwrite (existing files are backed up to *.specnaut.bak).`,
    );
  } else {
    console.error(
      `Re-run with ${bold("specnaut init --here --force")} to overwrite ` +
        "(existing files are backed up to *.specnaut.bak).",
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

  const path = `${targetDir}/.specnaut/backlog-config.yml`;
  try {
    await Deno.stat(path);
    return; // don't clobber an existing config
  } catch {
    // not present → write the stub
  }
  await Deno.mkdir(`${targetDir}/.specnaut`, { recursive: true });
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
  // Cloud is configured by API endpoint + token (filled into backlog-config.yml
  // post-init), not a Kanban URL — so there's no URL to resolve or prompt for.
  if (backend === "cloud") return { ok: true, url: null };
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
    console.error(red("error: `specnaut init` requires a project name or --here"));
    return 2;
  }

  // Rebrand migration: an existing project on the legacy `.specflow/` layout is
  // moved to `.specnaut/` before any conflict check or write.
  const migration = await migrateLegacyConfigDir(targetDir);
  if (migration.kind === "conflict") {
    console.error(
      red("error: both .specflow/ (legacy) and .specnaut/ exist — remove one before continuing"),
    );
    return 2;
  }
  if (migration.kind === "migrated") {
    console.log(dim("↳ migrated .specflow/ → .specnaut/ (legacy config dir)"));
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
      specBackend: "local",
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
  const specBackend = await resolveSpecBackend(intent.specBackend);

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

  // Parent-managed detection (009-parent-managed-init): when the target is a
  // member of a providing Specnaut workspace, agentic files are inherited from
  // the parent and suppressed locally. A `standalone.yml` override forces the
  // full standalone path. The use case applies the bundle filter.
  const parentReader = new FsParentWorkspaceReader();
  const standaloneOverride = await parentReader.hasStandaloneOverride(targetDir);
  const providingAncestor = await parentReader.findProvidingAncestor(targetDir);
  const parentManaged = isParentManaged(providingAncestor, standaloneOverride);
  if (parentManaged) {
    console.log(
      dim("parent-managed workspace detected — skills/agents inherited from parent"),
    );
  }

  // Preserve declarations (spec 011 / issue #367). Resolve the manifest
  // against the actual bundle dests for this run so we can (a) warn on
  // ineffective declarations (FR-008), (b) drop preserved paths from the
  // write set, and (c) emit one notice per preserved/overridden file
  // (FR-004/FR-005). The bundle is mapped exactly as the use case maps it,
  // including the parent-managed agentic filter so a declared agentic path in
  // a parent-managed sub-repo is a clean no-op (D8 — it is simply not a dest).
  const mappedForPreserve = harness.mapBundle(CORE_BUNDLE, {
    backlogBackend,
    versionScheme,
    specBackend,
  });
  const bundleDests = parentManaged
    ? Object.keys(mappedForPreserve).filter((d) => !isAgenticPath(d))
    : Object.keys(mappedForPreserve);
  const preserveCfg = await new FsPreserveStore().read(targetDir);
  const { known: declaredKnown, unknown: declaredUnknown } = resolvePreserveDeclarations(
    preserveCfg,
    bundleDests,
  );
  for (const path of declaredUnknown) {
    console.error(
      yellow(`warn: ${path} — declared preserved but not a managed file (ignored)`),
    );
  }
  // `--reset-preserved` overrides the declarations for this run: pass an empty
  // set and surface each override (FR-005). Otherwise honour the declarations.
  const preservedPaths = intent.resetPreserved ? new Set<string>() : new Set(declaredKnown);

  const useCase = new InitProjectUseCase({
    writer: new DenoFsWriter(),
    git: new DenoGit(),
    lockStore: new FsLockStore(),
    harness,
    backlogBackend,
    versionScheme,
    specBackend,
    core: CORE_BUNDLE,
    ensureDir: (path) => Deno.mkdir(path, { recursive: true }),
  });

  let result;
  try {
    result = await useCase.execute({
      targetDir,
      initGit: !intent.noGit,
      force: intent.force,
      dryRun: intent.dryRun,
      parentManaged,
      preservedPaths,
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
      specBackend,
    });
    const totalManaged = countManagedFiles(probeBundle);
    printConflictsError(result.conflicts, result.lockExists, totalManaged);
    return 3;
  }

  for (const w of result.warnings) console.error(yellow(`warn: ${w}`));
  // Preserve notices (FR-004) / reset overrides (FR-005) — never silent.
  if (intent.resetPreserved) {
    for (const path of declaredKnown) {
      console.log(
        yellow(`override ${path} — --reset-preserved overrode the declaration`),
      );
    }
  } else {
    for (const path of result.preserved) {
      console.log(
        cyan(`preserved ${path} — declared in .specnaut/preserve.yml`),
      );
    }
  }
  for (const b of result.backups) console.log(dim(`↳ backed up ${b} → ${b}.specnaut.bak`));
  const mergedSuffix = result.filesMerged.length > 0
    ? ` (+ merged: ${result.filesMerged.join(", ")})`
    : "";
  if (intent.dryRun) {
    console.log(
      green(`✓ would write ${result.filesWritten} files${mergedSuffix}`),
    );
    console.log(dim("(dry-run — no files written)"));
    return 0;
  }
  console.log(green(`✓ wrote ${result.filesWritten} files${mergedSuffix}`));

  await writeBacklogConfigStub(targetDir, backlogBackend, kanbanUrl, githubRepo);
  console.log("\nNext steps:");
  console.log(
    `  1. Open the project in ${harness.displayName}, then run ${
      bold("/specnaut constitution")
    } to scaffold your project's guiding principles`,
  );
  console.log(
    `  2. Edit ${bold("AGENTS.md")} and refine ${
      bold(".specnaut/memory/constitution.md")
    } for your stack`,
  );
  console.log(
    `  3. Run ${bold('/specnaut specify "<feature description>"')} to scaffold your first feature`,
  );
  console.log(`  4. Use ${bold('/backlog add "<task title>"')} for follow-up work`);

  // Specnaut Cloud funnel: point CLI users at the hosted product once they've
  // scaffolded — run headless + remote-control the agent's checkpoints. The
  // headless/remote pitch is worth showing regardless of backend, but when the
  // user already picked the cloud backlog backend the cloud strategy has already
  // emitted the `specnaut cloud login` CTA — so we drop the duplicate login line
  // here and just point at the site, keeping the call-to-action to once (#407).
  console.log(
    `\n${cyan("✦ Specnaut Cloud")} — run Specnaut headless and answer your agent from your phone:`,
  );
  console.log(
    dim(
      "     approve plans, answer clarifications & sign off merges remotely · hosted backlog + team roles.",
    ),
  );
  console.log(
    backlogBackend === "cloud"
      ? `     Learn more: ${cyan("https://specnaut.com")}`
      : `     Start free: ${bold("specnaut cloud login")} ${dim("·")} ${
        cyan("https://specnaut.com")
      }`,
  );
  return 0;
}
