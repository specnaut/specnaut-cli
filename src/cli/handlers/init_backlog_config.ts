import { dim, red } from "@std/fmt/colors";
import type { BacklogBackend } from "../../domain/installed_lock.ts";
import { findBacklogStrategy } from "../../domain/backlog_strategies/registry.ts";
import {
  type ParsedKanbanURL,
  parseKanbanURL,
} from "../../domain/backlog_strategies/kanban_url_parser.ts";
import { promptKanbanURL } from "../backlog_picker.ts";
import { assertInsideProject, resolveProjectRoot } from "../../infrastructure/fs_containment.ts";

/**
 * What `init` decides and writes about a remote backlog: the Kanban URL it
 * resolves, the repository it reads off the git remote, and the
 * `.specnaut/backlog-config.yml` stub it leaves for the user to finish.
 */

export async function writeBacklogConfigStub(
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
  // cli#574 — the backlog-config stub is written straight to disk here,
  // outside the bundle writer, so it needs the guard on its own.
  await assertInsideProject(await resolveProjectRoot(targetDir), path);
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
export function parseGithubRepoFromRemote(remote: string): string | null {
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
export function resolveKanbanURL(
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
