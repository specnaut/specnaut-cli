import type { BacklogBackend } from "./installed_lock.ts";

export type CoreCategory =
  | "agent"
  | "agent-memory"
  | "agent-doc"
  | "skill"
  | "phase"
  | "phase-script"
  | "spec-root"
  | "project-root"
  | "backlog-skill"
  | "backlog-doc"
  | "backlog-script"
  | "mergeable-project-root";

export type CoreEntry = {
  readonly category: CoreCategory;
  /**
   * What `name` means depends on the category, and for the two **sub-document**
   * categories — `phase` and `backlog-doc` — it is **the owning skill**, not
   * the document. The document is in `suffix`.
   *
   * That convention used to hold for `backlog-doc` only. `phase` put the
   * document in both fields and had no owner at all, so every harness adapter
   * hardcoded `specnaut` into the destination it composed — which made a second
   * top-level skill with its own documents impossible without editing all
   * seven. Converging the two categories is what `/ship` needed (spec 033), and
   * `skillDocDestination` is now the only place that composes such a path.
   */
  readonly name: string;
  readonly suffix: string | null;
  readonly content: string;
  readonly executable: boolean;
  /**
   * When set, the entry only applies if the chosen backlog backend matches.
   * Absent or `null` means the entry applies regardless of backend.
   */
  readonly backend?: BacklogBackend | null;
  /**
   * When `true`, the harness's `mapBundle` propagates this to the resulting
   * `TemplateFile.skipIfExists`. Used for placeholder files (`AGENTS.md`,
   * `.specnaut/memory/constitution.md`) where the user's existing content
   * is always more useful than our empty template — see #119.
   */
  readonly skipIfExists?: boolean;
  /**
   * Labels of the Specnaut-owned sections fenced inside `content`. The
   * harness's `mapBundle` propagates them to `TemplateFile.managedSection`,
   * which is what lets `upgrade` deliver those sections into a user-owned file
   * without rewriting the rest of it (#466).
   *
   * One label or several — see `managedSectionLabels` in `template.ts`, which
   * is the only place the union is resolved.
   */
  readonly managedSection?: string | readonly string[];
};

export type CoreBundle = ReadonlyArray<CoreEntry>;

/**
 * The document's own name for a sub-document entry — `merge-squash` for
 * `merge-squash.md`.
 *
 * Before the convergence (spec 033) a `phase` entry carried this in `name`, and
 * callers addressed a phase as `e.category === "phase" && e.name === "merge"`.
 * `name` is now the OWNING SKILL, so that comparison silently matches nothing —
 * or, worse for a `.find()`, matches the wrong entry.
 *
 * This exists so the `.md`-stripping lives in one place. Ten callers each
 * spelling `suffix.replace(/\.md$/, "")` would be ten statements of one rule,
 * which is the duplication spec 033 §5 forbids.
 */
export function skillDocName(entry: CoreEntry): string {
  return (entry.suffix ?? "").replace(/\.md$/, "");
}
