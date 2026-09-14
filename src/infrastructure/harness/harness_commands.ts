import type { KnownHarness } from "../../domain/installed_lock.ts";
import { SKILL_SURFACE } from "./skill_layout.ts";
import { skillNameFor } from "./skill_folder.ts";

/**
 * What a user actually types, per harness.
 *
 * `init`'s "Next steps" hardcoded the Claude surface — `/specnaut plan`,
 * `/board add` — and printed it under every harness. On the five that namespace
 * their skills the board is `/specnaut-board`, so the first thing a new user
 * was told to type did nothing; on Windsurf the phases are flat workflows, so
 * `/specnaut plan` was wrong too. It is the headline command of the release,
 * named wrong in the one place a first-time user reads.
 *
 * The shapes are not a preference. They fall out of where each harness's
 * `destinationFor` puts a skill and its documents:
 *
 *   - documents nested under their skill's own folder → the skill takes the
 *     document as an argument, `/specnaut plan`, `/ship tag-version`
 *   - documents emitted as sibling files (Windsurf) → each is its own command,
 *     `/specnaut-plan`, `/specnaut-ship-tag-version`
 *   - Copilot writes `.github/instructions/*.instructions.md`, which the agent
 *     applies by context rather than by invocation — there is no command to
 *     name, so it is `{ invocable: false }` and callers must narrow.
 *
 * **Derived from `SKILL_SURFACE`, not restated.** An earlier version of this
 * file carried its own table with `/specnaut ${name}` and `/specnaut-${name}`
 * written out, which meant the owner-prefix rule had two spellings and this one
 * had **no owner variable at all**. It could only ever name `specnaut`. The
 * moment a second skill owned documents it emitted, on a flat harness, a
 * command for a file that does not exist — a broken command string, not a
 * mislabel.
 *
 * The command shares its **inputs** with the destination, never its output: a
 * destination cannot be parsed back into `(owner, document)`, because
 * `specnaut-ship-release` splits as (`specnaut-ship`, `release`) or
 * (`specnaut`, `ship-release`) with nothing to choose between them.
 *
 * `harness_commands_test.ts` cross-checks every harness against the
 * destinations it really emits, so this cannot drift from the code it
 * describes without a red test.
 */
export type HarnessCommands =
  | { readonly invocable: false }
  | {
    readonly invocable: true;
    /** How a top-level skill is invoked: `/board`, `/specnaut-board`, `/ship`. */
    readonly skill: (name: string) => string;
    /**
     * How one of a skill's documents is invoked:
     * `/specnaut plan`, `/ship tag-version`, `/specnaut-ship-tag-version`.
     */
    readonly skillDoc: (owner: string, doc: string) => string;
  };

export function harnessCommands(harness: KnownHarness): HarnessCommands {
  const { layout, invocable } = SKILL_SURFACE[harness];
  if (!invocable) return { invocable: false };
  const token = (s: string) => skillNameFor(s, layout);
  return {
    invocable: true,
    skill: (name) => `/${token(name)}`,
    skillDoc: (owner, doc) =>
      layout.kind === "flat" ? `/${token(owner)}-${doc}` : `/${token(owner)} ${doc}`,
  };
}
