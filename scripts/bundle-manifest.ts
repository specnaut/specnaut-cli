/**
 * The shape of `templates/manifest.json`, read and checked for its sources before
 * anything is bundled. Out of `bundle-templates.ts`, which was over its size target.
 */

import type { MergeJsonFlavor } from "../src/domain/template.ts";

export type CoreManifestEntry = {
  category: string;
  name: string;
  suffix?: string;
  source: string;
  executable?: boolean;
  /** When set, the entry only applies if this backend is selected. */
  backend?: "local" | "github" | "gitlab";
  /** When true, the file is only written if absent (placeholder semantics). */
  skipIfExists?: boolean;
  /** The team's own file: written if absent, never rewritten (spec 038). */
  projectOwned?: boolean;
  /** Labels of the Specnaut-owned sections fenced inside the source (#466, #576). */
  managedSection?: string | readonly string[];
};

export type HarnessStaticManifestEntry = {
  harness: string;
  destination: string;
  /** Absent on a link entry, which has no file behind it. */
  source?: string;
  executable?: boolean;
  /** When set, the file is merged structurally rather than written verbatim. */
  mergeJson?: MergeJsonFlavor;
  /**
   * A context link (cli#680, cli#681): the destination is written as a relative
   * symlink with this text, and `fallback` — one line — where links are refused.
   */
  link?: string;
  fallback?: string;
  /** Read by the reach tests; the bundler only carries it. */
  alwaysOn?: boolean;
};

export type Manifest = {
  version: string;
  core: CoreManifestEntry[];
  harness_static: HarnessStaticManifestEntry[];
};

export async function readManifest(path: URL): Promise<Manifest> {
  return JSON.parse(await Deno.readTextFile(path)) as Manifest;
}

/** Every source the manifest names, a link entry's excepted: it has no file behind it. */
export function manifestSources(m: Manifest): string[] {
  const linked = m.harness_static.filter((e) => e.link === undefined);
  return [...m.core.map((e) => e.source), ...linked.map((e) => e.source ?? "(no source)")];
}

/** Fails the build on a source that is not a file under `templatesDir`, naming each. */
export async function assertAllSourcesPresent(m: Manifest, templatesDir: URL): Promise<void> {
  const missing: string[] = [];
  for (const source of manifestSources(m)) {
    if (!(await isFile(new URL(source, templatesDir)))) missing.push(source);
  }
  if (missing.length > 0) {
    throw new Error(`Missing template sources:\n  - ${missing.join("\n  - ")}`);
  }
}

/** Whether `path` is a file; a path that cannot be read is reported missing by the caller. */
async function isFile(path: URL): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}
