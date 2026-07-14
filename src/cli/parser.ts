import { parseArgs as stdParseArgs } from "@std/cli/parse-args";
import {
  type BacklogBackend,
  KNOWN_BACKLOG_BACKENDS,
  KNOWN_SPEC_BACKENDS,
  KNOWN_VERSION_SCHEMES,
  type SpecBackend,
  type VersionScheme,
} from "../domain/installed_lock.ts";

function validateBacklogArg(
  raw: string | null,
):
  | { ok: true; value: BacklogBackend | null }
  | { ok: false } {
  if (raw === null) return { ok: true, value: null };
  if ((KNOWN_BACKLOG_BACKENDS as ReadonlyArray<string>).includes(raw)) {
    return { ok: true, value: raw as BacklogBackend };
  }
  return { ok: false };
}

function validateSchemeArg(
  raw: string | null,
):
  | { ok: true; value: VersionScheme | null }
  | { ok: false } {
  if (raw === null) return { ok: true, value: null };
  if ((KNOWN_VERSION_SCHEMES as ReadonlyArray<string>).includes(raw)) {
    return { ok: true, value: raw as VersionScheme };
  }
  return { ok: false };
}

function validateSpecBackendArg(
  raw: string | null,
):
  | { ok: true; value: SpecBackend | null }
  | { ok: false } {
  if (raw === null) return { ok: true, value: null };
  if ((KNOWN_SPEC_BACKENDS as ReadonlyArray<string>).includes(raw)) {
    return { ok: true, value: raw as SpecBackend };
  }
  return { ok: false };
}

export type Intent =
  | { kind: "version" }
  | { kind: "help" }
  | {
    kind: "init";
    projectName: string | null;
    here: boolean;
    noGit: boolean;
    /**
     * Harness key when `--ai` was passed on the CLI; `null` when the user
     * did not specify one. The init handler is responsible for resolving
     * `null` to a concrete harness — interactively when stdin is a TTY,
     * silently to the default when it isn't (preserves CI behaviour).
     */
    ai:
      | "claude"
      | "cursor"
      | "codex"
      | "windsurf"
      | "copilot"
      | "opencode"
      | "antigravity"
      | null;
    /**
     * Backlog backend when `--backlog` was passed; `null` when not. Same
     * resolution semantics as `ai`: interactive prompt when stdin is a TTY,
     * default fallback otherwise.
     */
    backlog: BacklogBackend | null;
    /**
     * Raw Kanban / project URL passed via `--backlog-url`. The init handler
     * parses it via `parseKanbanURL` and writes the populated config stub.
     * `null` when not supplied — interactive prompt fires in TTY mode,
     * non-TTY + remote backend fails fast.
     */
    backlogUrl: string | null;
    /**
     * Optional GitHub repo override (`<owner>/<name>`) for the populated
     * config. When `null` and the backend is github, init derives it from
     * `git remote get-url origin`.
     */
    backlogRepo: string | null;
    /**
     * Explicit `--scheme` value. `null` triggers the interactive picker
     * (TTY) or the auto-detection default (non-TTY).
     */
    scheme: "semver" | "date" | null;
    /**
     * Explicit `--spec-backend` value (`local` | `cloud`). `null` triggers the
     * interactive picker (TTY) or the recommended default (non-TTY). Spec 020.
     */
    specBackend: SpecBackend | null;
    force: boolean;
    /**
     * `--dry-run`. Compute the plan (conflicts + would-write counts) and
     * print it without touching disk. Trumps `--force` — when both are
     * set, no writes happen. See issue #366.
     */
    dryRun: boolean;
    /**
     * `--reset-preserved`. Explicit opt-out (spec 011 / issue #367): override
     * preserve declarations for this forced refresh, restoring the bundled
     * versions. Never the default; reported per overridden file.
     */
    resetPreserved: boolean;
  }
  | { kind: "self-update"; checkOnly: boolean }
  | { kind: "check"; projectMode: boolean }
  | {
    kind: "upgrade";
    dryRun: boolean;
    force: boolean;
    /**
     * When set, switch the backlog backend to this value. Re-renders the
     * bundled backlog skill and updates the lock. `null` keeps the lock's
     * current backend.
     */
    backlog: BacklogBackend | null;
    /**
     * `--reset-baseline`. Heals stale lock SHAs by trusting the on-disk
     * content as the new baseline. See `UpgradeProjectInput.resetBaseline`.
     */
    resetBaseline: boolean;
    /**
     * `--reset-preserved`. Explicit opt-out (spec 011 / issue #367): ignore
     * preserve declarations for this upgrade so declared files are overwritten
     * with the bundle. Never the default; reported per overridden file.
     */
    resetPreserved: boolean;
  }
  | {
    /**
     * `specnaut diff` (spec 011 / issue #367, US2) — read-only divergence view:
     * show how each managed file on disk differs from the bundled original for
     * the installed templates version. Mutates nothing.
     */
    kind: "diff";
    /** `--only-customised`: restrict to paths whose disk SHA ≠ lock SHA. */
    onlyCustomised: boolean;
  }
  | { kind: "unknown"; received: string }
  | { kind: "reconcile-status" }
  | {
    kind: "reconcile-path";
    path: string;
    mode: "accept-upstream" | "accept-current";
  }
  | {
    kind: "cloud";
    /** Subcommand: `login` (interactive device auth), `token` (print a fresh
     *  access token for the scripts), `logout` (clear stored credentials),
     *  `orgs` (list the account's organizations), `board` (show the linked
     *  project's board). */
    sub: "login" | "token" | "logout" | "orgs" | "board";
    /** `--api-url` override; null = read from backlog-config.yml / prompt. */
    apiUrl: string | null;
  }
  | {
    /** `specnaut gate <status|raise|cancel>` (#358) — the non-interactive bridge
     *  a skill phase uses to raise a remote-control gate. See gate_handler.ts. */
    kind: "gate";
    sub: "status" | "raise" | "cancel";
    apiUrl: string | null;
    type: string | null;
    title: string | null;
    payload: string | null;
    task: number | null;
    id: string | null;
  }
  | {
    /** `specnaut spec <push|pull> <task>` (spec 020) — sync a task's spec with
     *  SpecNaut Cloud. Cloud-backend only; see spec_handler.ts. */
    kind: "spec";
    sub: "push" | "pull";
    task: number | null;
    apiUrl: string | null;
  };

export function parseArgs(argv: string[]): Intent {
  if (argv.length === 0) return { kind: "help" };

  const parsed = stdParseArgs(argv, {
    boolean: [
      "version",
      "help",
      "here",
      "no-git",
      "force",
      "check",
      "dry-run",
      "project",
      "reset-baseline",
      "reset-preserved",
      "only-customised",
      "status",
      "accept-upstream",
      "accept-current",
    ],
    string: [
      "ai",
      "backlog",
      "backlog-url",
      "backlog-repo",
      "scheme",
      "spec-backend",
      "api-url",
      "type",
      "title",
      "payload",
      "task",
    ],
    alias: { v: "version", h: "help" },
  });

  if (parsed.version) return { kind: "version" };
  if (parsed.help) return { kind: "help" };

  const [command, ...rest] = parsed._.map(String);
  if (command === "init") {
    const aiProvided = typeof parsed.ai === "string";
    const aiRaw = aiProvided ? (parsed.ai as string) : null;
    if (
      aiRaw !== null &&
      aiRaw !== "claude" &&
      aiRaw !== "cursor" &&
      aiRaw !== "codex" &&
      aiRaw !== "windsurf" &&
      aiRaw !== "copilot" &&
      aiRaw !== "opencode" &&
      aiRaw !== "antigravity"
    ) {
      return { kind: "unknown", received: `init --ai ${aiRaw}` };
    }
    const backlogProvided = typeof parsed.backlog === "string";
    const backlogRaw = backlogProvided ? (parsed.backlog as string) : null;
    const backlogResult = validateBacklogArg(backlogRaw);
    if (!backlogResult.ok) {
      return { kind: "unknown", received: `init --backlog ${backlogRaw}` };
    }
    const backlogUrlRaw = typeof parsed["backlog-url"] === "string"
      ? (parsed["backlog-url"] as string)
      : null;
    const backlogRepoRaw = typeof parsed["backlog-repo"] === "string"
      ? (parsed["backlog-repo"] as string)
      : null;
    const schemeProvided = typeof parsed.scheme === "string";
    const schemeRaw = schemeProvided ? (parsed.scheme as string) : null;
    const schemeResult = validateSchemeArg(schemeRaw);
    if (!schemeResult.ok) {
      return { kind: "unknown", received: `init --scheme ${schemeRaw}` };
    }
    const specBackendRaw = typeof parsed["spec-backend"] === "string"
      ? (parsed["spec-backend"] as string)
      : null;
    const specBackendResult = validateSpecBackendArg(specBackendRaw);
    if (!specBackendResult.ok) {
      return { kind: "unknown", received: `init --spec-backend ${specBackendRaw}` };
    }
    return {
      kind: "init",
      projectName: rest[0] ?? null,
      here: Boolean(parsed.here),
      noGit: Boolean(parsed["no-git"]),
      ai: aiRaw,
      backlog: backlogResult.value,
      backlogUrl: backlogUrlRaw,
      backlogRepo: backlogRepoRaw,
      scheme: schemeResult.value,
      specBackend: specBackendResult.value,
      force: Boolean(parsed.force),
      dryRun: Boolean(parsed["dry-run"]),
      resetPreserved: Boolean(parsed["reset-preserved"]),
    };
  }

  if (command === "self-update") {
    return { kind: "self-update", checkOnly: Boolean(parsed.check) };
  }

  if (command === "check") {
    return { kind: "check", projectMode: Boolean(parsed.project) };
  }

  if (command === "upgrade") {
    const backlogProvided = typeof parsed.backlog === "string";
    const backlogRaw = backlogProvided ? (parsed.backlog as string) : null;
    const backlogResult = validateBacklogArg(backlogRaw);
    if (!backlogResult.ok) {
      return { kind: "unknown", received: `upgrade --backlog ${backlogRaw}` };
    }
    return {
      kind: "upgrade",
      dryRun: Boolean(parsed["dry-run"]),
      force: Boolean(parsed.force),
      backlog: backlogResult.value,
      resetBaseline: Boolean(parsed["reset-baseline"]),
      resetPreserved: Boolean(parsed["reset-preserved"]),
    };
  }

  if (command === "diff") {
    return { kind: "diff", onlyCustomised: Boolean(parsed["only-customised"]) };
  }

  if (command === "reconcile") {
    const status = Boolean(parsed["status"]);
    const acceptUpstream = Boolean(parsed["accept-upstream"]);
    const acceptCurrent = Boolean(parsed["accept-current"]);
    // positional args after the "reconcile" command
    const positional = rest;

    if (status) {
      if (acceptUpstream || acceptCurrent || positional.length > 0) {
        return { kind: "unknown", received: "reconcile --status takes no other arguments" };
      }
      return { kind: "reconcile-status" };
    }

    if (acceptUpstream && acceptCurrent) {
      return {
        kind: "unknown",
        received: "reconcile --accept-upstream and --accept-current are mutually exclusive",
      };
    }
    if (!acceptUpstream && !acceptCurrent) {
      return {
        kind: "unknown",
        received:
          "specnaut reconcile requires --status, or <path> with --accept-upstream / --accept-current",
      };
    }
    if (positional.length !== 1) {
      return {
        kind: "unknown",
        received: "specnaut reconcile <path> requires exactly one path",
      };
    }
    return {
      kind: "reconcile-path",
      path: positional[0],
      mode: acceptUpstream ? "accept-upstream" : "accept-current",
    };
  }

  // `specnaut login` — top-level alias for `specnaut cloud login` (#398), the
  // verb users reach for first (à la `gh auth login`).
  if (command === "login") {
    const apiUrl = typeof parsed["api-url"] === "string" ? parsed["api-url"] : null;
    return { kind: "cloud", sub: "login", apiUrl };
  }

  if (command === "cloud") {
    const sub = rest[0];
    const apiUrl = typeof parsed["api-url"] === "string" ? parsed["api-url"] : null;
    if (
      sub === "login" ||
      sub === "token" ||
      sub === "logout" ||
      sub === "orgs" ||
      sub === "board"
    ) {
      return { kind: "cloud", sub, apiUrl };
    }
    return { kind: "unknown", received: `cloud ${sub ?? ""}`.trim() };
  }

  if (command === "gate") {
    const sub = rest[0];
    if (sub !== "status" && sub !== "raise" && sub !== "cancel") {
      return { kind: "unknown", received: `gate ${sub ?? ""}`.trim() };
    }
    const str = (
      k: string,
    ): string | null => (typeof parsed[k] === "string" ? parsed[k] as string : null);
    const taskRaw = str("task");
    const taskNum = taskRaw !== null && /^\d+$/.test(taskRaw) ? Number(taskRaw) : null;
    return {
      kind: "gate",
      sub,
      apiUrl: str("api-url"),
      type: str("type"),
      title: str("title"),
      payload: str("payload"),
      task: taskNum,
      id: rest[1] ?? null, // `gate cancel <id>`
    };
  }

  if (command === "spec") {
    const sub = rest[0];
    if (sub !== "push" && sub !== "pull") {
      return { kind: "unknown", received: `spec ${sub ?? ""}`.trim() };
    }
    // `spec <push|pull> <task>` — the task number is a positional after the sub.
    const taskRaw = rest[1] ?? null;
    const task = taskRaw !== null && /^\d+$/.test(taskRaw) ? Number(taskRaw) : null;
    const apiUrl = typeof parsed["api-url"] === "string" ? parsed["api-url"] : null;
    return { kind: "spec", sub, task, apiUrl };
  }

  return { kind: "unknown", received: command ?? "" };
}
