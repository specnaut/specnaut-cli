// Generates the hook files whose content is derived, never hand-kept (spec 036):
//
//   - templates/harness-specific/shared/hooks/_agents.txt — the Specnaut agent
//     names, from the manifest (T012). guard-dispatch-model.sh reads it.
//   - templates/harness-specific/shared/hooks/SHA256SUMS — every other file in
//     that folder, hashed.
//   - templates/harness-specific/codex/hooks.json — the Codex registrations.
//
// Why the last two exist: Codex records hook trust against the hook DEFINITION
// (event, matcher, command string), never the script the command runs (plan
// § 11 Measured). Each Codex command therefore carries the hash of SHA256SUMS
// and checks the folder against it before running anything, so a changed
// script changes `hooks.json` and Codex asks for trust again. Claude Code has
// no hash trust; its registrations in settings.json stay plain. The command
// itself is spelled in src/domain/hook_command.ts, beside the pattern the merge
// recognises it by, so the two cannot drift.
//
// Runs before bundle-templates.ts (`deno task bundle`). `--check` writes
// nothing and exits 1 when a generated file is stale — the test suite runs it.

import { encodeHex } from "@std/encoding/hex";
import { fromFileUrl, join } from "@std/path";
import { type CodexHookCall, codexHookCommand } from "../src/domain/hook_command.ts";

// fromFileUrl, not `.pathname`: on Windows that is `/D:/…`, which no API opens.
const ROOT = fromFileUrl(new URL("..", import.meta.url));
const HOOKS = join(ROOT, "templates/harness-specific/shared/hooks");
const CODEX_HOOKS_JSON = join(ROOT, "templates/harness-specific/codex/hooks.json");

type Registration = CodexHookCall & { readonly event: string; readonly matcher?: string };

/** The Codex registrations — the counterpart of templates/harness-specific/claude/settings.json. */
export const CODEX_REGISTRATIONS: readonly Registration[] = [
  { event: "PreToolUse", matcher: "Bash", script: "guard-merge.sh", args: "codex", onChanged: 2 },
  { event: "PreToolUse", matcher: "Bash", script: "guard-release.sh", args: "codex", onChanged: 2 },
  {
    event: "PreToolUse",
    matcher: "Edit|Write",
    script: "protect-generated.sh",
    args: "codex",
    onChanged: 2,
  },
  {
    event: "PreToolUse",
    matcher: "Edit|Write",
    script: "protect-constitution.sh",
    args: "codex",
    onChanged: 2,
  },
  {
    event: "PreToolUse",
    matcher: "Bash",
    script: "protect-constitution.sh",
    args: "codex",
    onChanged: 2,
  },
  {
    event: "PreToolUse",
    matcher: "Agent",
    script: "guard-dispatch-model.sh",
    args: "codex",
    onChanged: 2,
  },
  { event: "UserPromptSubmit", script: "approve-on-prompt.sh", args: "codex", onChanged: 0 },
  { event: "Stop", script: "approve-on-prompt.sh", args: "codex", onChanged: 0 },
  { event: "SubagentStart", script: "log-subagent.sh", args: "start", onChanged: 0 },
  { event: "SubagentStop", script: "log-subagent.sh", args: "stop", onChanged: 0 },
];

async function sha256(bytes: BufferSource): Promise<string> {
  return encodeHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

async function agentNames(): Promise<string[]> {
  const manifest = JSON.parse(await Deno.readTextFile(join(ROOT, "templates/manifest.json")));
  const names = new Set<string>();
  for (const e of manifest.core ?? []) {
    const m = e.category === "agent" && typeof e.source === "string"
      ? /^core\/agents\/([a-z0-9-]+)\.md$/.exec(e.source)
      : null;
    if (m && m[1] !== "README") names.add(m[1]);
  }
  return [...names].sort();
}

/** Every generated file, path → content. */
export async function generate(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const agents = [
    "# The Specnaut agents: one name per line, generated from the Specnaut",
    "# manifest when the binary is built. guard-dispatch-model.sh reads it.",
    ...(await agentNames()),
    "",
  ].join("\n");
  out.set(join(HOOKS, "_agents.txt"), agents);

  const files: string[] = [];
  for await (const e of Deno.readDir(HOOKS)) {
    if (e.isFile && e.name !== "SHA256SUMS") files.push(e.name);
  }
  // _agents.txt is hashed as generated, not as it may sit on disk.
  const lines: string[] = [];
  for (const name of files.sort()) {
    const bytes = name === "_agents.txt"
      ? new TextEncoder().encode(agents)
      : await Deno.readFile(join(HOOKS, name));
    lines.push(`${await sha256(bytes)}  ${name}`);
  }
  const sums = lines.join("\n") + "\n";
  out.set(join(HOOKS, "SHA256SUMS"), sums);

  const sumsHash = await sha256(new TextEncoder().encode(sums));
  const hooks: Record<string, { matcher?: string; hooks: unknown[] }[]> = {};
  for (const r of CODEX_REGISTRATIONS) {
    const groups = hooks[r.event] ??= [];
    let group = groups.find((g) => g.matcher === r.matcher);
    if (!group) {
      groups.push(
        group = r.matcher === undefined ? { hooks: [] } : { matcher: r.matcher, hooks: [] },
      );
    }
    group.hooks.push({ type: "command", command: codexHookCommand(r, sumsHash), timeout: 10 });
  }
  out.set(CODEX_HOOKS_JSON, JSON.stringify({ hooks }, null, 2) + "\n");
  return out;
}

/**
 * A generated file's current content, or `null` when it was never written.
 * Only absence is `null`: any other failure (a directory in the way, no
 * permission) is rethrown, or `--check` would report it as merely stale and a
 * write would be attempted over something that is not the file.
 */
export async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}

if (import.meta.main) {
  const check = Deno.args.includes("--check");
  let stale = 0;
  for (const [path, content] of await generate()) {
    const current = await readIfPresent(path);
    if (current === content) continue;
    if (check) {
      console.error(`stale: ${path} — run deno task bundle`);
      stale++;
    } else {
      await Deno.writeTextFile(path, content);
      console.log(`wrote ${path}`);
    }
  }
  if (stale > 0) Deno.exit(1);
}
