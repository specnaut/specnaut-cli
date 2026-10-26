// Reads templates/manifest.json + templates/** and emits src/templates_bundle.ts.
// The generated module exports:
//   - TEMPLATES_VERSION: string
//   - CORE_BUNDLE: CoreBundle (from src/domain/core_bundle.ts)
//   - HARNESS_STATIC: Record<harnessKey, Record<destination, TemplateFile>>
// Runtime code reads nothing from disk.

import { relative } from "@std/path";
import { managedSectionLabels } from "../src/domain/template.ts";

type CoreManifestEntry = {
  category: string;
  name: string;
  suffix?: string;
  source: string;
  executable?: boolean;
  /** When set, the entry only applies if this backend is selected. */
  backend?: "local" | "github" | "gitlab";
  /** When true, the file is only written if absent (placeholder semantics). */
  skipIfExists?: boolean;
  /** Labels of the Specnaut-owned sections fenced inside the source (#466, #576). */
  managedSection?: string | readonly string[];
};

type HarnessStaticManifestEntry = {
  harness: string;
  destination: string;
  source: string;
  executable?: boolean;
  /** When set, the file is merged structurally rather than written verbatim. */
  mergeJson?: "claude-settings";
};

type Manifest = {
  version: string;
  core: CoreManifestEntry[];
  harness_static: HarnessStaticManifestEntry[];
};

const ROOT = new URL("..", import.meta.url);
const TEMPLATES_DIR = new URL("templates/", ROOT);
const MANIFEST_PATH = new URL("templates/manifest.json", ROOT);
const OUTPUT_PATH = new URL("src/templates_bundle.ts", ROOT);
/** `deno fmt`'s line width, read from its one home so the emitter cannot disagree with it. */
const FMT_LINE_WIDTH: number = JSON.parse(
  await Deno.readTextFile(new URL("deno.json", ROOT)),
).fmt.lineWidth;

async function readManifest(): Promise<Manifest> {
  return JSON.parse(await Deno.readTextFile(MANIFEST_PATH)) as Manifest;
}

async function assertAllSourcesPresent(m: Manifest): Promise<void> {
  const missing: string[] = [];
  const check = async (source: string) => {
    const abs = new URL(source, TEMPLATES_DIR);
    try {
      const s = await Deno.stat(abs);
      if (!s.isFile) missing.push(source);
    } catch {
      missing.push(source);
    }
  };
  for (const e of m.core) await check(e.source);
  for (const e of m.harness_static) await check(e.source);
  if (missing.length > 0) {
    throw new Error(`Missing template sources:\n  - ${missing.join("\n  - ")}`);
  }
}

/**
 * A manifest entry declaring `managedSection` promises the binary a fenced
 * region it can graft into a user-owned file. If the fences are not actually
 * in the source, `upgrade` would silently deliver nothing — the failure mode
 * #466 exists to fix. Fail the build instead.
 */
async function assertManagedSectionsFenced(m: Manifest): Promise<void> {
  const broken: string[] = [];
  const wrongFormat: string[] = [];
  for (const e of m.core) {
    // Every declared label is checked, not just the first. A destination may
    // declare several (#576), and a loop that stopped at one would let the
    // second ship unfenced — which is precisely the silent no-delivery this
    // check exists to prevent, arriving through the door the fix opened.
    const labels = managedSectionLabels(e.managedSection);
    if (labels.length === 0) continue;
    // The fence is an HTML comment, which is invisible in Markdown and literal
    // visible text anywhere else. The mechanism reads as format-agnostic and is
    // not: a second entry pointing at a non-Markdown destination would render
    // its own markers into the file. Fail here rather than let that ship — the
    // fix is to derive the fence style from the destination, not to add an HTML
    // comment to a file that has no such thing.
    if (!e.source.endsWith(".md")) {
      for (const label of labels) wrongFormat.push(`${e.source} (label "${label}")`);
      continue;
    }
    const content = await Deno.readTextFile(new URL(e.source, TEMPLATES_DIR));
    for (const label of labels) {
      const start = `<!-- --- Specnaut: ${label} --- -->`;
      const end = `<!-- --- End Specnaut: ${label} --- -->`;
      const s = content.indexOf(start);
      const t = content.indexOf(end);
      if (s === -1 || t === -1 || t <= s) {
        broken.push(`${e.source} (label "${label}")`);
      }
    }
  }
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

function escapeTemplateLiteral(content: string): string {
  return content.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

async function buildCoreEntries(m: Manifest): Promise<string[]> {
  const lines: string[] = [];
  for (const entry of m.core) {
    const abs = new URL(entry.source, TEMPLATES_DIR);
    const content = await Deno.readTextFile(abs);
    const suffix = entry.suffix === undefined ? "null" : JSON.stringify(entry.suffix);
    const backend = entry.backend === undefined ? "null" : JSON.stringify(entry.backend);
    const skipIfExists = entry.skipIfExists === true ? "true" : "false";
    // Emitted so `deno fmt` leaves it alone. `JSON.stringify` on an array
    // produces `["a","b"]` with no space after the comma, which fmt rewrites —
    // so `deno task bundle` would dirty the tree for `fmt --check` on every
    // run, and only CI would ever say so. It was a string until #576 and the
    // question could not arise. Past the line width fmt breaks an ARRAY one
    // element per line, so the emitter does the same, or a fifth label dirties
    // the tree exactly as above. A single label stays a string at any length.
    const labels = managedSectionLabels(entry.managedSection);
    const quoted = labels.map((l) => JSON.stringify(l));
    const inline = `    managedSection: ${
      labels.length === 1 ? quoted[0] : `[${quoted.join(", ")}]`
    },`;
    const managedSection = labels.length === 0
      ? ""
      : labels.length === 1 || inline.length <= FMT_LINE_WIDTH
      ? `${inline}\n`
      : `    managedSection: [\n${quoted.map((q) => `      ${q},\n`).join("")}    ],\n`;
    lines.push(
      `  {\n` +
        `    category: ${JSON.stringify(entry.category)},\n` +
        `    name: ${JSON.stringify(entry.name)},\n` +
        `    suffix: ${suffix},\n` +
        `    content: \`${escapeTemplateLiteral(content)}\`,\n` +
        `    executable: ${entry.executable === true},\n` +
        `    backend: ${backend},\n` +
        `    skipIfExists: ${skipIfExists},\n` +
        managedSection +
        `  }`,
    );
  }
  return lines;
}

async function buildHarnessStatic(m: Manifest): Promise<string> {
  const byHarness: Record<
    string,
    Array<{
      destination: string;
      content: string;
      executable: boolean;
      mergeJson?: "claude-settings";
    }>
  > = {};
  for (const e of m.harness_static) {
    const abs = new URL(e.source, TEMPLATES_DIR);
    const content = await Deno.readTextFile(abs);
    byHarness[e.harness] ??= [];
    byHarness[e.harness].push({
      destination: e.destination,
      content,
      executable: e.executable === true,
      ...(e.mergeJson ? { mergeJson: e.mergeJson } : {}),
    });
  }
  const outer: string[] = [];
  for (const harness of Object.keys(byHarness).sort()) {
    const inner = byHarness[harness].map((f) => {
      const mergeJsonLine = f.mergeJson !== undefined
        ? `      mergeJson: ${JSON.stringify(f.mergeJson)},\n`
        : "";
      return (
        `    ${JSON.stringify(f.destination)}: {\n` +
        `      content: \`${escapeTemplateLiteral(f.content)}\`,\n` +
        `      executable: ${f.executable},\n` +
        mergeJsonLine +
        `    }`
      );
    }).join(",\n");
    outer.push(`  ${JSON.stringify(harness)}: {\n${inner},\n  }`);
  }
  return outer.join(",\n");
}

async function main() {
  const manifest = await readManifest();
  await assertAllSourcesPresent(manifest);
  await assertManagedSectionsFenced(manifest);
  const core = await buildCoreEntries(manifest);
  const staticBlock = await buildHarnessStatic(manifest);

  const src = `// THIS FILE IS GENERATED BY scripts/bundle-templates.ts — DO NOT EDIT BY HAND.
import type { CoreBundle } from "./domain/core_bundle.ts";
import type { TemplateFile } from "./domain/template.ts";

export const TEMPLATES_VERSION = ${JSON.stringify(manifest.version)};

export const CORE_BUNDLE: CoreBundle = [
${core.join(",\n")},
];

export const HARNESS_STATIC: Record<string, Record<string, TemplateFile>> = {
${staticBlock},
};
`;
  await Deno.writeTextFile(OUTPUT_PATH, src);
  console.log(
    `Bundled ${manifest.core.length} core entries + ${manifest.harness_static.length} harness-specific → ${
      relative(Deno.cwd(), OUTPUT_PATH.pathname)
    }`,
  );
}

if (import.meta.main) await main();
