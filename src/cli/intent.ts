import type { BacklogBackend, SpecBackend } from "../domain/installed_lock.ts";

/**
 * What the command line asks for: `parseArgs` returns one, `main.ts` dispatches on its `kind`.
 * Its own module so the parser holds the reading of argv and nothing else (plan A17).
 */

/**
 * `specnaut scan` (#747): a token-free map of the repository's structure against its size limits.
 * `path` is a repository-relative subtree, already validated (`scan_parser.ts`); `top` is how long
 * each list may be, `"all"` for no bound.
 */
export type ScanIntent = {
  kind: "scan";
  path: string | null;
  format: "text" | "json" | "mermaid";
  top: number | "all";
};

/**
 * `specnaut sandbox`: `probe` reports which backend would run a branch's gates; `exec` runs
 * `command` on the export of `sha` in it, the `toolchain` folders read-only and on its PATH.
 */
export type SandboxIntent =
  | { kind: "sandbox"; sub: "probe" }
  | {
    kind: "sandbox";
    sub: "exec";
    sha: string;
    toolchain: string[];
    command: string[];
    /** `--log`: the new file the run's output goes to, capped and control-stripped; else ours. */
    log: string | null;
  };

/**
 * `specnaut review`: `gate` is the hook's checkout check, `start` exports the branch `source`
 * names once the gate passed, `end` removes the export of `sha` (review_handler.ts).
 */
export type ReviewIntent =
  | { kind: "review"; sub: "gate" }
  | { kind: "review"; sub: "start"; source: string }
  | { kind: "review"; sub: "end"; sha: string };

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
    /**
     * Optional positional: restrict the view to one managed path. `null` is the
     * whole-project view. An unrecognised path is an error, not a silent
     * fallback to the whole project (#594).
     */
    path: string | null;
  }
  | { kind: "unknown"; received: string }
  /** `init --ai <key>` naming a harness Specnaut used to support. */
  | { kind: "removed-harness"; harness: string }
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
  }
  | ScanIntent
  | SandboxIntent
  /** `specnaut verify-scripts`: whether `.specnaut/scripts/` matches the base (verify_scripts_handler.ts). */
  | { kind: "verify-scripts" }
  /** `specnaut record-checkout`: a `SessionStart` hook records the checkout (record_checkout_handler.ts). */
  | { kind: "record-checkout" }
  | ReviewIntent;
