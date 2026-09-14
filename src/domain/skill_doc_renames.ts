import type { CoreEntry } from "./core_bundle.ts";

/**
 * A skill sub-document that changed address between template versions.
 *
 * Declared as **(owner, document)** rather than as a path, deliberately. A path
 * is harness-specific — the same document is
 * `.claude/skills/ship/phases/tag.md` on Claude and
 * `.windsurf/workflows/specnaut-ship-tag.md` on Windsurf — and spelling either
 * here would be a second statement of the adapter's rule, which spec 033 §5
 * forbids. The harness resolves both ends itself.
 */
export interface SkillDocRename {
  readonly from: { readonly owner: string; readonly doc: string };
  readonly to: { readonly owner: string; readonly doc: string };
  /** Why it moved — surfaced to the user when a customised file travels. */
  readonly reason: string;
}

/**
 * **Why this exists at all.**
 *
 * Without it, a document that changes address is two unrelated events to
 * `upgrade`: an orphan at the old path and a new file at the new one. The
 * user's bytes are not lost — a customised orphan is deleted only under
 * `--force`, and then with a backup — but they stop being *read*. The agent
 * loads the vanilla document at the new address while the edit sits at the old
 * one, and the upgrade reports success.
 *
 * That is worse than losing them. If the edit was a guardrail — "never publish
 * without a signed tag" — the guardrail is now inert and nothing said so.
 *
 * Carrying the lock identity across the move makes the rename ONE event: the
 * bytes arrive at the new address and land in the ordinary `customized` bucket,
 * where the upgrade summary names them like any other divergence.
 */
export const SKILL_DOC_RENAMES: ReadonlyArray<SkillDocRename> = [
  {
    from: { owner: "specnaut", doc: "tag-version.md" },
    to: { owner: "ship", doc: "tag.md" },
    reason: "release concerns moved from /specnaut to /ship",
  },
  {
    from: { owner: "specnaut", doc: "release-version.md" },
    to: { owner: "ship", doc: "release.md" },
    reason: "release concerns moved from /specnaut to /ship",
  },
];

/**
 * A synthetic bundle entry standing for one end of a rename, so a harness can
 * be asked where it *would* have put it. The content is irrelevant — only the
 * destination is read — but it must be a well-formed entry or `mapBundle`
 * refuses it.
 */
export function renameEndpointEntry(owner: string, doc: string): CoreEntry {
  return { category: "phase", name: owner, suffix: doc, content: "", executable: false };
}
