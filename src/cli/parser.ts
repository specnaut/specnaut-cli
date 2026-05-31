import { parseArgs as stdParseArgs } from "@std/cli/parse-args";
import {
  type BacklogBackend,
  KNOWN_BACKLOG_BACKENDS,
  KNOWN_VERSION_SCHEMES,
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
    force: boolean;
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
     *  access token for the scripts), `logout` (clear stored credentials). */
    sub: "login" | "token" | "logout";
    /** `--api-url` override; null = read from backlog-config.yml / prompt. */
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
      "status",
      "accept-upstream",
      "accept-current",
    ],
    string: ["ai", "backlog", "backlog-url", "backlog-repo", "scheme", "api-url"],
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
      force: Boolean(parsed.force),
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
    };
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
          "specflow reconcile requires --status, or <path> with --accept-upstream / --accept-current",
      };
    }
    if (positional.length !== 1) {
      return {
        kind: "unknown",
        received: "specflow reconcile <path> requires exactly one path",
      };
    }
    return {
      kind: "reconcile-path",
      path: positional[0],
      mode: acceptUpstream ? "accept-upstream" : "accept-current",
    };
  }

  if (command === "cloud") {
    const sub = rest[0];
    const apiUrl = typeof parsed["api-url"] === "string" ? parsed["api-url"] : null;
    if (sub === "login" || sub === "token" || sub === "logout") {
      return { kind: "cloud", sub, apiUrl };
    }
    return { kind: "unknown", received: `cloud ${sub ?? ""}`.trim() };
  }

  return { kind: "unknown", received: command ?? "" };
}
