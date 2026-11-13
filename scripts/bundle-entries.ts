/**
 * The source text of the bundle's `CORE_BUNDLE` entries and `HARNESS_STATIC` map,
 * emitted so `deno fmt` leaves it as written. Out of `bundle-templates.ts`, which
 * was over its size target.
 */

import { managedSectionLabels, type MergeJsonFlavor } from "../src/domain/template.ts";
import { contentField } from "./bundle-content-field.ts";
import type { CoreManifestEntry, Manifest } from "./bundle-manifest.ts";

/** One `CORE_BUNDLE` entry for `entry`, whose source holds `content`. */
export function coreEntry(entry: CoreManifestEntry, content: string, width: number): string {
  const suffix = entry.suffix === undefined ? "null" : JSON.stringify(entry.suffix);
  const backend = entry.backend === undefined ? "null" : JSON.stringify(entry.backend);
  const skipIfExists = entry.skipIfExists === true ? "true" : "false";
  return `  {\n` +
    `    category: ${JSON.stringify(entry.category)},\n` +
    `    name: ${JSON.stringify(entry.name)},\n` +
    `    suffix: ${suffix},\n` +
    contentField("    ", content, width) +
    `    executable: ${entry.executable === true},\n` +
    `    backend: ${backend},\n` +
    `    skipIfExists: ${skipIfExists},\n` +
    (entry.projectOwned === true ? `    projectOwned: true,\n` : "") +
    managedSectionField(managedSectionLabels(entry.managedSection), width) +
    `  }`;
}

/**
 * The `managedSection` line, or none. Emitted so `deno fmt` leaves it alone.
 * `JSON.stringify` on an array produces `["a","b"]` with no space after the comma,
 * which fmt rewrites — so `deno task bundle` would dirty the tree for `fmt --check`
 * on every run, and only CI would ever say so. It was a string until #576 and the
 * question could not arise. Past the line width fmt breaks an ARRAY one element per
 * line, so the emitter does the same, or a fifth label dirties the tree exactly as
 * above. A single label stays a string at any length.
 */
export function managedSectionField(labels: readonly string[], width: number): string {
  if (labels.length === 0) return "";
  const quoted = labels.map((l) => JSON.stringify(l));
  const inline = `    managedSection: ${
    labels.length === 1 ? quoted[0] : `[${quoted.join(", ")}]`
  },`;
  if (labels.length === 1 || inline.length <= width) return `${inline}\n`;
  return `    managedSection: [\n${quoted.map((q) => `      ${q},\n`).join("")}    ],\n`;
}

/** A `HARNESS_STATIC` file, as the bundle carries it. */
export type StaticFile = {
  destination: string;
  content: string;
  executable: boolean;
  mergeJson?: MergeJsonFlavor;
  symlinkTo?: string;
};

/** The `HARNESS_STATIC` map's body: harnesses sorted, each one's files in manifest order. */
export function harnessStatic(byHarness: Record<string, StaticFile[]>, width: number): string {
  return Object.keys(byHarness).sort().map((harness) => {
    const inner = byHarness[harness].map((f) => staticFile(f, width)).join(",\n");
    return `  ${JSON.stringify(harness)}: {\n${inner},\n  }`;
  }).join(",\n");
}

function staticFile(f: StaticFile, width: number): string {
  const mergeJsonLine = f.mergeJson !== undefined
    ? `      mergeJson: ${JSON.stringify(f.mergeJson)},\n`
    : "";
  const symlinkLine = f.symlinkTo !== undefined
    ? `      symlinkTo: ${JSON.stringify(f.symlinkTo)},\n`
    : "";
  return `    ${JSON.stringify(f.destination)}: {\n` +
    contentField("      ", f.content, width) +
    `      executable: ${f.executable},\n` +
    mergeJsonLine +
    symlinkLine +
    `    }`;
}

/** The manifest's harness files grouped by harness, each source read with `read`. */
export async function staticFilesByHarness(
  m: Manifest,
  read: (source: string) => Promise<string>,
): Promise<Record<string, StaticFile[]>> {
  const byHarness: Record<string, StaticFile[]> = {};
  for (const e of m.harness_static) {
    // A link's content IS its fallback, so every content reader reads a line.
    const content = e.link !== undefined ? `${e.fallback}\n` : await read(e.source!);
    (byHarness[e.harness] ??= []).push({
      destination: e.destination,
      content,
      executable: e.executable === true,
      ...(e.mergeJson ? { mergeJson: e.mergeJson } : {}),
      ...(e.link !== undefined ? { symlinkTo: e.link } : {}),
    });
  }
  return byHarness;
}
