import { parseArgs as stdParseArgs } from "@std/cli/parse-args";
import { normaliseDiffPath } from "../domain/diff.ts";
import { KNOWN_BACKLOG_BACKENDS } from "../domain/installed_lock.ts";
import type { Intent } from "./intent.ts";
import { parseInit } from "./init_parser.ts";
import { validateKnownArg } from "./known_value.ts";
import { parseReconcile } from "./reconcile_parser.ts";
import { parseScan } from "./scan_parser.ts";

export type { Intent } from "./intent.ts";

/** Every flag any command reads; a command ignores the ones it does not take. */
const PARSE_OPTIONS = {
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
    "path",
    "format",
    "top",
  ],
  alias: { v: "version", h: "help" },
} as const;

export function parseArgs(argv: string[]): Intent {
  if (argv.length === 0) return { kind: "help" };

  const parsed = stdParseArgs(argv, PARSE_OPTIONS);

  if (parsed.version) return { kind: "version" };
  if (parsed.help) return { kind: "help" };

  const [command, ...rest] = parsed._.map(String);
  if (command === "init") return parseInit(parsed, rest);

  if (command === "scan") return parseScan(parsed, rest);

  if (command === "verify-scripts") {
    if (rest.length > 0) return { kind: "unknown", received: "verify-scripts takes no argument" };
    return { kind: "verify-scripts" };
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
    const backlogResult = validateKnownArg(backlogRaw, KNOWN_BACKLOG_BACKENDS);
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
    // One path at a time. Accepting several and diffing only the first is the
    // same silent-success shape the positional used to have when it was
    // dropped entirely.
    if (rest.length > 1) {
      return { kind: "unknown", received: "diff takes at most one path" };
    }
    return {
      kind: "diff",
      onlyCustomised: Boolean(parsed["only-customised"]),
      path: rest.length === 1 ? normaliseDiffPath(rest[0]) : null,
    };
  }

  if (command === "reconcile") return parseReconcile(parsed, rest);

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
