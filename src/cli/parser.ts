import { parseArgs as stdParseArgs } from "@std/cli/parse-args";

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
      | "gemini"
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
    backlog: "local" | "github" | "gitlab" | null;
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
    backlog: "local" | "github" | "gitlab" | null;
  }
  | { kind: "backlog-removed" }
  | { kind: "unknown"; received: string };

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
    ],
    string: ["ai", "backlog"],
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
      aiRaw !== "gemini" &&
      aiRaw !== "windsurf" &&
      aiRaw !== "copilot" &&
      aiRaw !== "opencode" &&
      aiRaw !== "antigravity"
    ) {
      return { kind: "unknown", received: `init --ai ${aiRaw}` };
    }
    const backlogProvided = typeof parsed.backlog === "string";
    const backlogRaw = backlogProvided ? (parsed.backlog as string) : null;
    if (
      backlogRaw !== null &&
      backlogRaw !== "local" &&
      backlogRaw !== "github" &&
      backlogRaw !== "gitlab"
    ) {
      return { kind: "unknown", received: `init --backlog ${backlogRaw}` };
    }
    return {
      kind: "init",
      projectName: rest[0] ?? null,
      here: Boolean(parsed.here),
      noGit: Boolean(parsed["no-git"]),
      ai: aiRaw,
      backlog: backlogRaw,
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
    if (
      backlogRaw !== null &&
      backlogRaw !== "local" &&
      backlogRaw !== "github" &&
      backlogRaw !== "gitlab"
    ) {
      return { kind: "unknown", received: `upgrade --backlog ${backlogRaw}` };
    }
    return {
      kind: "upgrade",
      dryRun: Boolean(parsed["dry-run"]),
      force: Boolean(parsed.force),
      backlog: backlogRaw,
    };
  }

  // The `backlog` CLI command (sync + configure) was removed in v0.9.0.
  // Catch it explicitly so we can emit a friendlier upgrade hint instead
  // of the generic "Unknown command" + full help dump.
  if (command === "backlog") return { kind: "backlog-removed" };

  return { kind: "unknown", received: command ?? "" };
}
