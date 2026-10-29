import { assertEquals } from "@std/assert";
import { CORE_BUNDLE, HARNESS_STATIC } from "../../src/templates_bundle.ts";
import { HARNESSES } from "../../src/cli/harnesses.ts";
import { everyBundleOption } from "../../src/application/bundle_options.ts";

/**
 * Specnaut names no model version (specnaut-cli#707, Kevin 2026-10-29).
 *
 * Models move within weeks, so a versioned id written into a scaffolded
 * project makes it obsolete the day it ships — and on Codex a pinned id fails
 * at dispatch once the account's catalogue drops it. Model FAMILIES may be
 * named (Haiku, Sonnet, Opus, Fable; Luna, Terra, Sol, Astra); versions, and
 * harness versions, may not. Scanned on what every adapter emits, for every
 * bundle option, so a version that only a backend or a harness renders is
 * still caught.
 */

const VERSIONED = [
  /\bgpt-\d/i,
  /\bclaude-(?:opus|sonnet|haiku|fable)-\d/i,
  /\bgemini-\d/i,
  /\b(?:Claude Code|Codex(?: CLI)?) v?\d+\.\d+/,
];

/** Every line of `content` that names a version, as `dest:line`. */
function hits(dest: string, content: string): string[] {
  return content.split("\n").flatMap((line, i) =>
    VERSIONED.some((re) => re.test(line)) ? [`${dest}:${i + 1}: ${line.trim()}`] : []
  );
}

Deno.test("no emitted file, for any harness or bundle option, names a model version", () => {
  const found = new Set<string>();
  for (const harness of HARNESSES) {
    for (const opts of everyBundleOption()) {
      for (const [dest, file] of Object.entries(harness.mapBundle(CORE_BUNDLE, opts))) {
        for (const h of hits(`${harness.key}:${dest}`, file.content)) found.add(h);
      }
    }
  }
  assertEquals([...found], [], "shipped text names a model or harness version");
});

Deno.test("no harness-specific static file names a model version", () => {
  const found = Object.entries(HARNESS_STATIC).flatMap(([key, files]) =>
    Object.entries(files).flatMap(([dest, f]) => hits(`${key}:${dest}`, f.content))
  );
  assertEquals(found, [], "a static harness file names a model or harness version");
});

Deno.test("the scan recognises the shapes it forbids", () => {
  // Non-vacuity: a regex that matched nothing would pass every bundle.
  for (
    const line of ['model = "gpt-5.6-sol"', "claude-sonnet-4-6", "Requires Claude Code v2.1.139+"]
  ) {
    assertEquals(hits("probe", line).length, 1, line);
  }
  for (const line of ["model: opus", "# Model family: Sol (opus on Claude Code)", "Codex CLI"]) {
    assertEquals(hits("probe", line), [], line);
  }
});
