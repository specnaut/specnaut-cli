/**
 * Parses a Kanban / project board URL into a structured payload usable
 * by the per-backend strategies to pre-fill `.specnaut/backlog-config.yml`.
 *
 * Three formats supported:
 *
 *   - GitHub org-owned project:
 *     `https://github.com/orgs/<org>/projects/<N>`
 *     (a trailing `/views/<M>` is tolerated — that's what the browser
 *     address bar always contains when viewing a Project V2 board)
 *     → `{ kind: "github", owner: "<org>", ownerType: "org", projectNumber: N }`
 *
 *   - GitHub user-owned project:
 *     `https://github.com/users/<user>/projects/<N>` (same `/views/<M>`
 *     tolerance as above)
 *     → `{ kind: "github", owner: "<user>", ownerType: "user", projectNumber: N }`
 *
 *   - GitLab project URL (project page = backlog board, no separate URL):
 *     `https://<host>/<group>/<project>` with an exact 2-segment path
 *     and host that is NOT `github.com` (otherwise we'd confuse a plain
 *     GitHub repo URL for a GitLab project)
 *     → `{ kind: "gitlab", host: "<host>", projectPath: "<group>/<project>" }`
 *
 * Anything else returns `null`. The caller decides whether to throw,
 * re-prompt, or fall through to the empty stub.
 *
 * Pure — no IO, no Deno globals.
 */

export type ParsedKanbanURL =
  | {
    kind: "github";
    owner: string;
    ownerType: "org" | "user";
    projectNumber: number;
  }
  | {
    kind: "gitlab";
    host: string;
    projectPath: string;
  };

export function parseKanbanURL(raw: string): ParsedKanbanURL | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;

  const segments = u.pathname.split("/").filter((s) => s.length > 0);

  if (u.host === "github.com") {
    // GitHub: must be /orgs/<owner>/projects/<N> or /users/<owner>/projects/<N>,
    // optionally followed by /views/<M> (the browser address bar always
    // appends a view ID when looking at a Project V2 board).
    if (
      segments.length !== 4 &&
      !(segments.length === 6 && segments[4] === "views")
    ) {
      return null;
    }
    const [kindSeg, owner, projectsSeg, numSeg] = segments;
    if (kindSeg !== "orgs" && kindSeg !== "users") return null;
    if (projectsSeg !== "projects") return null;
    if (!owner) return null;
    const projectNumber = parseInt(numSeg, 10);
    if (!Number.isInteger(projectNumber) || projectNumber <= 0) return null;
    if (String(projectNumber) !== numSeg) return null; // reject "1abc"
    return {
      kind: "github",
      owner,
      ownerType: kindSeg === "orgs" ? "org" : "user",
      projectNumber,
    };
  }

  // GitLab: any other host with exactly 2 path segments — `<group>/<project>`.
  // (Self-hosted GitLab is supported by accepting any host that isn't
  // github.com.) GitLab nested groups (3+ segments) are not supported in
  // this first iteration; if the user has one, they can still hand-edit
  // the config.
  if (segments.length === 2) {
    const [group, project] = segments;
    if (!group || !project) return null;
    return {
      kind: "gitlab",
      host: u.host,
      projectPath: `${group}/${project}`,
    };
  }

  return null;
}
