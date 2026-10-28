import type { LinkState } from "./context_link.ts";
import type { UpgradeAction } from "./upgrade_action.ts";

/**
 * A link state the planner can act on. `inverted` is not one: the use case
 * refuses that destination before planning, because every action here ends in
 * a write to it, and there it is the user's only copy.
 */
export type PlannableLinkState = Exclude<LinkState, "inverted">;

/**
 * The plan action for a context-link destination, decided by what is on disk
 * there rather than by comparing shas: reading `.claude/CLAUDE.md` through the
 * link reads `AGENTS.md`, so a sha of the destination says nothing about it.
 *
 * Generated and materialised files are ours to rewrite, so they update without
 * a backup (unless `--force` asks for one). A customized file or a foreign link
 * is not ours, so it is replaced with a backup — always.
 */
export function linkAction(
  dest: string,
  state: PlannableLinkState,
  lockSha: string | undefined,
  newSha: string,
): UpgradeAction {
  switch (state) {
    case "absent":
      return { kind: "add-new", dest };
    case "ours-link":
    case "ours-fallback":
      return { kind: "unchanged", dest };
    case "materialised":
    case "generated":
      return { kind: "auto-update", dest, oldSha: lockSha ?? "", newSha };
    case "customized":
      return { kind: "replace-with-link", dest, previous: "customized-file" };
    case "foreign-link":
      return { kind: "replace-with-link", dest, previous: "foreign-link" };
  }
}
