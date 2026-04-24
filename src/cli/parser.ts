import { parseArgs as stdParseArgs } from "@std/cli/parse-args";

export type Intent =
  | { kind: "version" }
  | { kind: "help" }
  | {
    kind: "init";
    projectName: string | null;
    here: boolean;
    noGit: boolean;
    ai: "claude";
    force: boolean;
  }
  | { kind: "self-update"; checkOnly: boolean }
  | { kind: "backlog-sync"; singleId: string | null; dryRun: boolean; allowSecrets: boolean }
  | { kind: "backlog-configure" }
  | { kind: "check"; projectMode: boolean }
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
      "allow-secrets",
      "project",
    ],
    string: ["id"],
    alias: { v: "version", h: "help" },
  });

  if (parsed.version) return { kind: "version" };
  if (parsed.help) return { kind: "help" };

  const [command, ...rest] = parsed._.map(String);
  if (command === "init") {
    return {
      kind: "init",
      projectName: rest[0] ?? null,
      here: Boolean(parsed.here),
      noGit: Boolean(parsed["no-git"]),
      ai: "claude",
      force: Boolean(parsed.force),
    };
  }

  if (command === "self-update") {
    return { kind: "self-update", checkOnly: Boolean(parsed.check) };
  }

  if (command === "backlog") {
    const sub = rest[0];
    if (sub === "sync") {
      return {
        kind: "backlog-sync",
        singleId: typeof parsed.id === "string" ? parsed.id : null,
        dryRun: Boolean(parsed["dry-run"]),
        allowSecrets: Boolean(parsed["allow-secrets"]),
      };
    }
    if (sub === "configure") {
      return { kind: "backlog-configure" };
    }
    return { kind: "unknown", received: "backlog (missing subcommand)" };
  }

  if (command === "check") {
    return { kind: "check", projectMode: Boolean(parsed.project) };
  }

  return { kind: "unknown", received: command ?? "" };
}
