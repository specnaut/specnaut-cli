import { isRemovedHarness } from "../domain/installed_lock.ts";
import { parseArgs as stdParseArgs } from "@std/cli/parse-args";
import { normaliseDiffPath } from "../domain/diff.ts";
import {
  KNOWN_BACKLOG_BACKENDS,
  KNOWN_SPEC_BACKENDS,
  KNOWN_VERSION_SCHEMES,
} from "../domain/installed_lock.ts";
import type { Intent } from "./intent.ts";
import { parseReconcile } from "./reconcile_parser.ts";
import { parseScan } from "./scan_parser.ts";

export type { Intent } from "./intent.ts";

/** `raw` if it is one of `known`, `null` if absent; `{ ok: false }` names an unknown value. */
function validateKnownArg<T extends string>(
  raw: string | null,
  known: ReadonlyArray<T>,
): { ok: true; value: T | null } | { ok: false } {
  if (raw === null) return { ok: true, value: null };
  return (known as ReadonlyArray<string>).includes(raw)
    ? { ok: true, value: raw as T }
    : { ok: false };
}

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
  if (command === "init") {
    const aiProvided = typeof parsed.ai === "string";
    const aiRaw = aiProvided ? (parsed.ai as string) : null;
    if (aiRaw !== null && isRemovedHarness(aiRaw)) {
      return { kind: "removed-harness", harness: aiRaw };
    }
    if (
      aiRaw !== null &&
      aiRaw !== "claude" &&
      aiRaw !== "cursor" &&
      aiRaw !== "codex" &&
      aiRaw !== "copilot" &&
      aiRaw !== "opencode" &&
      aiRaw !== "antigravity"
    ) {
      return { kind: "unknown", received: `init --ai ${aiRaw}` };
    }
    const backlogProvided = typeof parsed.backlog === "string";
    const backlogRaw = backlogProvided ? (parsed.backlog as string) : null;
    const backlogResult = validateKnownArg(backlogRaw, KNOWN_BACKLOG_BACKENDS);
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
    const schemeResult = validateKnownArg(schemeRaw, KNOWN_VERSION_SCHEMES);
    if (!schemeResult.ok) {
      return { kind: "unknown", received: `init --scheme ${schemeRaw}` };
    }
    const specBackendRaw = typeof parsed["spec-backend"] === "string"
      ? (parsed["spec-backend"] as string)
      : null;
    const specBackendResult = validateKnownArg(specBackendRaw, KNOWN_SPEC_BACKENDS);
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

  if (command === "scan") return parseScan(parsed, rest);

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
