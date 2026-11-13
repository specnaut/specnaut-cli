/**
 * The bundler's check that every `managedSection` a manifest entry declares is
 * fenced in its source. Out of `bundle-templates.ts`, which was over its size target.
 */

import { managedSectionLabels } from "../src/domain/template.ts";
import type { CoreManifestEntry } from "./bundle-manifest.ts";

/** What is wrong with the managed sections of the core entries, in two lists. */
export type FenceFaults = { readonly broken: string[]; readonly wrongFormat: string[] };

/**
 * The labels of `source` whose fences are not in `content`, each named as
 * `<source> (label "<label>")`. Every declared label is checked, not just the
 * first. A destination may declare several (#576), and a loop that stopped at one
 * would let the second ship unfenced — which is precisely the silent no-delivery
 * this check exists to prevent, arriving through the door the fix opened.
 */
export function unfenced(source: string, labels: readonly string[], content: string): string[] {
  return labels.filter((label) => {
    const s = content.indexOf(`<!-- --- Specnaut: ${label} --- -->`);
    const t = content.indexOf(`<!-- --- End Specnaut: ${label} --- -->`);
    return s === -1 || t === -1 || t <= s;
  }).map((label) => `${source} (label "${label}")`);
}

/**
 * The faults of every core entry declaring `managedSection`, its source read with
 * `read`. The fence is an HTML comment, which is invisible in Markdown and literal
 * visible text anywhere else. The mechanism reads as format-agnostic and is not: a
 * second entry pointing at a non-Markdown destination would render its own markers
 * into the file. It is a fault rather than let that ship — the fix is to derive the
 * fence style from the destination, not to add an HTML comment to a file that has
 * no such thing.
 */
export async function fenceFaults(
  core: readonly CoreManifestEntry[],
  read: (source: string) => Promise<string>,
): Promise<FenceFaults> {
  const faults: FenceFaults = { broken: [], wrongFormat: [] };
  for (const e of core) {
    const labels = managedSectionLabels(e.managedSection);
    if (labels.length === 0) continue;
    if (!e.source.endsWith(".md")) {
      faults.wrongFormat.push(...labels.map((label) => `${e.source} (label "${label}")`));
    } else {
      faults.broken.push(...unfenced(e.source, labels, await read(e.source)));
    }
  }
  return faults;
}

/**
 * A manifest entry declaring `managedSection` promises the binary a fenced
 * region it can graft into a user-owned file. If the fences are not actually
 * in the source, `upgrade` would silently deliver nothing — the failure mode
 * #466 exists to fix. Fail the build instead.
 */
export async function assertManagedSectionsFenced(
  core: readonly CoreManifestEntry[],
  templatesDir: URL,
): Promise<void> {
  const read = (source: string) => Deno.readTextFile(new URL(source, templatesDir));
  const { broken, wrongFormat } = await fenceFaults(core, read);
  if (wrongFormat.length > 0) {
    throw new Error(
      "managedSection is only supported on Markdown sources — the fence is an " +
        `HTML comment:\n  - ${wrongFormat.join("\n  - ")}`,
    );
  }
  if (broken.length > 0) {
    throw new Error(
      `managedSection declared but not fenced in the source:\n  - ${broken.join("\n  - ")}`,
    );
  }
}
