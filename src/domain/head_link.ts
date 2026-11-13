import { badLinkForm, LINK_REASON } from "./checkout_link.ts";
import { exactlyInScope, inComparedRoot } from "./instruction_scope.ts";
import type { BaseEntry, Untrusted } from "./script_trust.ts";

/**
 * A link HEAD commits among the instruction files, judged by where it leads in HEAD's own tree.
 * The work tree's check follows a link on disk, which a checkout that writes links as files
 * (`core.symlinks=false`) never shows; what lands is the link, so it is read here as text,
 * whatever the checkout writes: it holds only when it leads to a path this class judges.
 */

/**
 * Where `target`, read from the folder of the link at `path`, leads within the project: a path
 * relative to its root, or `null` when it leaves it, is absolute, or is empty.
 */
export function linkEnd(path: string, target: string): string | null {
  if (target === "" || target.startsWith("/")) return null;
  const parts = path.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else if (part !== "." && part !== "") parts.push(part);
  }
  return parts.length === 0 ? null : parts.join("/");
}

/** Each link among HEAD's instruction `entries` that does not lead to a path this class judges. */
export function headLinkReasons(entries: readonly BaseEntry[]): Untrusted[] {
  const byPath = new Map(entries.map((e) => [e.path, e]));
  return entries.flatMap((e) => {
    if (e.kind !== "link") return [];
    const reason = endReason(e.target ?? "", e.path, byPath);
    return reason === null ? [] : [{ path: e.path, reason }];
  });
}

function endReason(
  target: string,
  path: string,
  atHead: ReadonlyMap<string, BaseEntry>,
): string | null {
  if (badLinkForm(target)) return LINK_REASON.linkForm;
  const end = linkEnd(path, target);
  if (end === null) return LINK_REASON.linkLeaves;
  if (inComparedRoot(end)) return null;
  if (!exactlyInScope(end)) return LINK_REASON.linkLeaves;
  const at = atHead.get(end);
  if (at === undefined) return `${LINK_REASON.linkUnresolved}: not at HEAD`;
  return at.kind === "submodule" ? LINK_REASON.linkLeaves : null;
}
