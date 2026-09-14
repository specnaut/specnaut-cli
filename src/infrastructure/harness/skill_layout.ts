import type { KnownHarness } from "../../domain/installed_lock.ts";
import type { SkillDocShape } from "./skill_folder.ts";

/**
 * How one harness surfaces skills — where their files go, and whether a user
 * can type a command to reach them.
 */
export interface SkillSurface {
  readonly layout: SkillDocShape;
  /**
   * Whether the harness has slash commands at all.
   *
   * Copilot does not: it applies `.github/instructions/**` by context, so there
   * is nothing to type. That is absence, not an empty string — see
   * `harness_commands.ts` for why the difference is load-bearing.
   */
  readonly invocable: boolean;
}

/**
 * **The single home for each harness's skill layout.**
 *
 * Before this table the seven shape literals were inlined in seven adapters,
 * and the *same* namespacing rule was spelled a second time in the command
 * table — where it had no owner variable, so it produced a command naming the
 * wrong skill the moment a second skill owned documents.
 *
 * Both consumers now read from here: `destinationFor` composes the file path,
 * `harnessCommands` composes what the user types. They share the **inputs**,
 * never the output string — the destination cannot be parsed back into
 * `(owner, document)`, because `${owner}-${doc}` is ambiguous at the separator:
 * `specnaut-ship-release` splits as (`specnaut-ship`, `release`) or
 * (`specnaut`, `ship-release`) with nothing to choose between them.
 */
export const SKILL_SURFACE: Record<KnownHarness, SkillSurface> = {
  claude: {
    layout: { kind: "nested", root: ".claude/skills", namespaced: false },
    invocable: true,
  },
  cursor: {
    layout: { kind: "nested", root: ".cursor/skills", namespaced: true },
    invocable: true,
  },
  codex: {
    layout: { kind: "nested", root: ".agents/skills", namespaced: true },
    invocable: true,
  },
  antigravity: {
    layout: { kind: "nested", root: ".agents/skills", namespaced: true },
    invocable: true,
  },
  opencode: {
    layout: { kind: "nested", root: ".opencode/skills", namespaced: true },
    invocable: true,
  },
  windsurf: {
    layout: { kind: "flat", dir: ".windsurf/workflows", ext: ".md" },
    invocable: true,
  },
  copilot: {
    layout: { kind: "flat", dir: ".github/instructions", ext: ".instructions.md" },
    invocable: false,
  },
};
