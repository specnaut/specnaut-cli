import { assert, assertEquals, assertStringIncludes } from "@std/assert";
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

/**
 * One forbidden spelling, with the lines that prove it is live.
 *
 * Each probe must be caught by its own shape and by no other (asserted below),
 * so deleting or weakening a shape turns its probes red instead of being
 * silently covered by a neighbour — the guard cannot lose a shape unnoticed.
 */
interface Shape {
  readonly name: string;
  readonly re: RegExp;
  readonly probes: readonly string[];
}

const SHAPES: readonly Shape[] = [
  {
    name: "OpenAI gpt id",
    re: /(?:\b|chat)gpt[- ]?(?:\d|oss)/i,
    probes: ['model = "gpt-5.6-sol"', "chatgpt-4o-latest", "gpt-oss-120b", "GPT 5", "GPT5"],
  },
  {
    name: "Claude family followed by a version",
    re: /\b(?:opus|sonnet|haiku|fable)-\d/i,
    probes: ["claude-sonnet-4-6", "sonnet-4.5"],
  },
  {
    name: "Claude version before family",
    re: /\bclaude[- ]\d/i,
    probes: ["claude-3-5-sonnet", "Claude 3.5 Sonnet", "Claude 4"],
  },
  {
    name: "Claude family and version in prose",
    re: /\b(?:opus|sonnet|haiku|fable) v?\d/i,
    probes: ["Claude Opus 4.1"],
  },
  { name: "Gemini id", re: /\bgemini-\d/i, probes: ["gemini-2.5-pro"] },
  { name: "Gemini version in prose", re: /\bgemini \d/i, probes: ["Gemini 2.5"] },
  // Case-sensitive on purpose: an o-series id is always lower case.
  { name: "OpenAI o-series id", re: /\bo\d+\b/, probes: ["o3", "o4-mini"] },
  {
    name: "codex model id",
    re: /\bcodex-(?:mini\b|\d)/i,
    probes: ["codex-mini-latest", "codex-1"],
  },
  {
    name: "harness version",
    re:
      /\b(?:claude code|codex(?: cli)?|cursor|copilot(?: cli)?|opencode|antigravity|gemini cli) v?\d/i,
    probes: [
      "Requires Claude Code v2.1.139+",
      "Claude Code v2",
      "codex cli 0.46",
      "Cursor 1.7",
      "Copilot CLI v0.0.339",
      "OpenCode v0.15",
      "Gemini CLI 0.1",
    ],
  },
];

/** Every line of `content` that names a version, as `dest:line`. */
function hits(dest: string, content: string): string[] {
  return content.split("\n").flatMap((line, i) =>
    SHAPES.some(({ re }) => re.test(line)) ? [`${dest}:${i + 1}: ${line.trim()}`] : []
  );
}

/**
 * What every adapter emits for every bundle option, as `[harness:dest, content]`
 * — one pair per option, so a version only one option renders is still read.
 */
function emittedFiles(): (readonly [string, string])[] {
  return HARNESSES.flatMap((harness) =>
    everyBundleOption().flatMap((opts) =>
      Object.entries(harness.mapBundle(CORE_BUNDLE, opts)).map(([dest, file]) =>
        [`${harness.key}:${dest}`, file.content] as const
      )
    )
  );
}

Deno.test("no emitted file, for any harness or bundle option, names a model version", () => {
  const files = emittedFiles();
  // A scan of nothing passes every bundle: prove it reached content, and the
  // file where a version was last shipped (a Codex role TOML) in particular.
  assert(files.length > 0, "the scan read no emitted file");
  const codexDeveloper = files.find(([dest]) => dest === "codex:.codex/agents/developer.toml");
  assert(codexDeveloper !== undefined, "the Codex developer agent TOML was not scanned");
  assertStringIncludes(codexDeveloper[1], "# Model family:");
  const found = new Set(files.flatMap(([dest, content]) => hits(dest, content)));
  assertEquals([...found], [], "shipped text names a model or harness version");
});

Deno.test("no harness-specific static file names a model version", () => {
  const files = Object.entries(HARNESS_STATIC).flatMap(([key, fs]) =>
    Object.entries(fs).map(([dest, f]) => [`${key}:${dest}`, f.content] as const)
  );
  assert(files.length > 0, "the scan read no static harness file");
  const found = files.flatMap(([dest, content]) => hits(dest, content));
  assertEquals(found, [], "a static harness file names a model or harness version");
});

Deno.test("each forbidden shape catches its probes, and no other shape does", () => {
  // Non-vacuity: a regex that matched nothing would pass every bundle.
  for (const shape of SHAPES) {
    for (const probe of shape.probes) {
      assert(shape.re.test(probe), `${shape.name} misses its probe: ${probe}`);
      const also = SHAPES.filter((s) => s !== shape && s.re.test(probe)).map((s) => s.name);
      assertEquals(also, [], `${probe} is also caught by ${also} — ${shape.name} is not pinned`);
    }
  }
});

/**
 * The ids the guard must stop, kept apart from SHAPES on purpose: deleting a
 * shape deletes its own probes, but not these, so a lost shape turns red here.
 */
const FORBIDDEN = [
  "gpt-5.6-sol",
  "chatgpt-4o-latest",
  "gpt-oss-120b",
  "GPT 5",
  "claude-sonnet-4-6",
  "sonnet-4.5",
  "claude-3-5-sonnet",
  "Claude 3.5 Sonnet",
  "Claude Opus 4.1",
  "gemini-2.5-pro",
  "Gemini 2.5",
  "o3",
  "o4-mini",
  "codex-mini-latest",
  "codex-1",
  "Claude Code v2",
  "codex cli 0.46",
  "Cursor 1.7",
  "Copilot CLI v0.0.339",
  "OpenCode v0.15",
  "Gemini CLI 0.1",
];

Deno.test("the scan's own matcher flags every forbidden id", () => {
  for (const id of FORBIDDEN) {
    assertEquals(hits("probe", `uses ${id} here`).length, 1, `hits() lets ${id} through`);
  }
});

Deno.test("the scan lets model families and harness names through", () => {
  for (
    const line of [
      "model: opus",
      "# Model family: Sol (opus on Claude Code)",
      "Codex CLI",
      "Opus is the default; eight of the nine seats keep it.",
      "| Fable | Astra |",
    ]
  ) {
    assertEquals(hits("probe", line), [], line);
  }
});
