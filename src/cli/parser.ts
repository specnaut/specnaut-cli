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
  }
  | { kind: "unknown"; received: string };

export function parseArgs(argv: string[]): Intent {
  if (argv.length === 0) return { kind: "help" };

  const parsed = stdParseArgs(argv, {
    boolean: ["version", "help", "here", "no-git"],
    string: ["ai"],
    alias: { v: "version", h: "help" },
    default: { ai: "claude" },
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
    };
  }

  return { kind: "unknown", received: command ?? "" };
}
