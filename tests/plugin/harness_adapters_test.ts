// Harness-adapter consistency gates — Epic #270 / C2 #284.
//
// The plugin distribution targets ship per-harness manifests at the
// repo root:
//
//   - plugin/.claude-plugin/plugin.json   — Claude Code (canonical
//                                            source for shared
//                                            metadata)
//   - .codex-plugin/plugin.json           — Codex CLI / Codex App
//   - .cursor-plugin/plugin.json          — Cursor
//   - gemini-extension.json               — Gemini CLI
//   - .opencode/plugins/specflow.js       — OpenCode (JS adapter,
//                                            no manifest version
//                                            field — runtime read)
//
// This test gates **consistency** across those files. It is the
// multi-harness equivalent of the existing `plugin_sync_test.ts`
// byte-identity gate for `templates/core/` ↔ `plugin/` mirrors. The
// adapters are standalone files (no `templates/core/` source), so
// "consistency" here means:
//
//   1. Every manifest parses as valid JSON
//   2. Required fields present (name, version, description, …)
//   3. `name` is "specflow" everywhere
//   4. `version` matches `deno.json` (already gated at release time
//      by `release.yml` pre-flight; re-asserted here so the test
//      suite catches drift locally without waiting for CI)
//   5. Path references resolve to existing files / directories
//   6. `GEMINI.md` @-references resolve to existing files
//
// If any harness adapter ships fields that are required by that
// harness's plugin loader but missing here, add a new test below —
// don't paper over a manifest gap.

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

function abs(rel: string): string {
  return fromFileUrl(new URL(`../../${rel}`, import.meta.url));
}

async function readJson<T = unknown>(rel: string): Promise<T> {
  const raw = await Deno.readTextFile(abs(rel));
  return JSON.parse(raw) as T;
}

async function pathExists(rel: string): Promise<boolean> {
  try {
    await Deno.stat(abs(rel));
    return true;
  } catch {
    return false;
  }
}

// Helpers ----------------------------------------------------------

type SemverString = string;

async function readDenoVersion(): Promise<SemverString> {
  const deno = await readJson<{ version: string }>("deno.json");
  return deno.version;
}

// Tests ------------------------------------------------------------

Deno.test("harness adapter — every manifest parses as JSON", async () => {
  for (
    const path of [
      "plugin/.claude-plugin/plugin.json",
      ".codex-plugin/plugin.json",
      ".cursor-plugin/plugin.json",
      "gemini-extension.json",
    ]
  ) {
    const raw = await Deno.readTextFile(abs(path));
    JSON.parse(raw); // throws if malformed — that's the gate
  }
});

Deno.test("harness adapter — name is 'specflow' or 'specflow-plugin' everywhere", async () => {
  const claude = await readJson<{ name: string }>(
    "plugin/.claude-plugin/plugin.json",
  );
  // Historical naming: the Claude Code plugin is published as
  // `specflow-plugin` (matches the marketplace listing). All other
  // adapters use the unprefixed `specflow` — they install via their
  // harness's `plugin install specflow` command shape.
  assertEquals(claude.name, "specflow-plugin");

  for (
    const path of [
      ".codex-plugin/plugin.json",
      ".cursor-plugin/plugin.json",
      "gemini-extension.json",
    ]
  ) {
    const m = await readJson<{ name: string }>(path);
    assertEquals(m.name, "specflow", `${path} name must be 'specflow'`);
  }
});

Deno.test("harness adapter — version matches deno.json across all manifests", async () => {
  const expected = await readDenoVersion();
  for (
    const path of [
      "plugin/.claude-plugin/plugin.json",
      ".codex-plugin/plugin.json",
      ".cursor-plugin/plugin.json",
      "gemini-extension.json",
    ]
  ) {
    const m = await readJson<{ version: string }>(path);
    assertEquals(
      m.version,
      expected,
      `${path} version ${m.version} must match deno.json version ${expected} — run scripts/bump-version.ts to fix drift`,
    );
  }
});

Deno.test("harness adapter — required fields present in every manifest", async () => {
  for (
    const path of [
      "plugin/.claude-plugin/plugin.json",
      ".codex-plugin/plugin.json",
      ".cursor-plugin/plugin.json",
      "gemini-extension.json",
    ]
  ) {
    const m = await readJson<Record<string, unknown>>(path);
    assert(
      typeof m.name === "string" && m.name.length > 0,
      `${path} missing name`,
    );
    assert(
      typeof m.version === "string" && m.version.length > 0,
      `${path} missing version`,
    );
    assert(
      typeof m.description === "string" && m.description.length > 0,
      `${path} missing description`,
    );
  }
});

Deno.test("harness adapter — Codex manifest has required interface block", async () => {
  type CodexManifest = {
    skills?: string;
    interface?: {
      displayName?: string;
      shortDescription?: string;
      category?: string;
      capabilities?: unknown[];
      composerIcon?: string;
      logo?: string;
    };
    privacyPolicyURL?: string;
    termsOfServiceURL?: string;
  };
  const m = await readJson<CodexManifest>(".codex-plugin/plugin.json");
  assert(typeof m.skills === "string", "Codex manifest missing skills path");
  assert(m.interface, "Codex manifest missing interface block");
  assert(
    typeof m.interface.displayName === "string",
    "Codex interface.displayName required",
  );
  assert(
    typeof m.interface.shortDescription === "string",
    "Codex interface.shortDescription required",
  );
  assert(
    typeof m.interface.category === "string",
    "Codex interface.category required",
  );
  assert(
    Array.isArray(m.interface.capabilities) && m.interface.capabilities.length > 0,
    "Codex interface.capabilities required (non-empty array)",
  );
  assert(
    typeof m.interface.composerIcon === "string",
    "Codex interface.composerIcon required",
  );
  assert(typeof m.interface.logo === "string", "Codex interface.logo required");
  assert(
    typeof m.privacyPolicyURL === "string",
    "Codex privacyPolicyURL required (marketplace UX)",
  );
  assert(
    typeof m.termsOfServiceURL === "string",
    "Codex termsOfServiceURL required",
  );
});

Deno.test("harness adapter — Cursor manifest has required path refs", async () => {
  type CursorManifest = {
    displayName?: string;
    skills?: string;
    agents?: string;
    hooks?: string;
  };
  const m = await readJson<CursorManifest>(".cursor-plugin/plugin.json");
  assert(
    typeof m.displayName === "string",
    "Cursor manifest missing displayName",
  );
  assert(typeof m.skills === "string", "Cursor manifest missing skills path");
  assert(typeof m.agents === "string", "Cursor manifest missing agents path");
  assert(typeof m.hooks === "string", "Cursor manifest missing hooks path");
});

Deno.test("harness adapter — Gemini extension uses GEMINI.md as contextFileName", async () => {
  const m = await readJson<{ contextFileName?: string }>(
    "gemini-extension.json",
  );
  assertEquals(
    m.contextFileName,
    "GEMINI.md",
    "Gemini extension must point at GEMINI.md (the convention is repo-root; changing this breaks the canonical install path)",
  );
});

Deno.test("harness adapter — path references resolve to existing files", async () => {
  // Codex: skills + assets
  const codex = await readJson<{
    skills: string;
    interface: { composerIcon: string; logo: string };
  }>(".codex-plugin/plugin.json");
  assert(
    await pathExists(codex.skills.replace(/^\.\//, "")),
    `Codex skills path ${codex.skills} does not resolve to a directory`,
  );
  assert(
    await pathExists(codex.interface.composerIcon.replace(/^\.\//, "")),
    `Codex composerIcon ${codex.interface.composerIcon} does not exist`,
  );
  assert(
    await pathExists(codex.interface.logo.replace(/^\.\//, "")),
    `Codex logo ${codex.interface.logo} does not exist`,
  );

  // Cursor: skills + agents + hooks file
  const cursor = await readJson<{
    skills: string;
    agents: string;
    hooks: string;
  }>(".cursor-plugin/plugin.json");
  assert(
    await pathExists(cursor.skills.replace(/^\.\//, "")),
    `Cursor skills path ${cursor.skills} does not resolve to a directory`,
  );
  assert(
    await pathExists(cursor.agents.replace(/^\.\//, "")),
    `Cursor agents path ${cursor.agents} does not resolve to a directory`,
  );
  assert(
    await pathExists(cursor.hooks.replace(/^\.\//, "")),
    `Cursor hooks file ${cursor.hooks} does not exist`,
  );

  // Gemini: contextFileName at repo root
  assert(
    await pathExists("GEMINI.md"),
    "GEMINI.md required at repo root for the Gemini extension contextFileName contract",
  );
});

Deno.test("harness adapter — GEMINI.md @-references resolve to existing files", async () => {
  const raw = await Deno.readTextFile(abs("GEMINI.md"));
  // Each non-empty line should be an @-reference to a relative path
  // that exists. Gemini's context-file mechanism resolves @./ paths
  // relative to the GEMINI.md location (repo root in our case).
  const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  assert(lines.length > 0, "GEMINI.md must not be empty");
  for (const line of lines) {
    assert(
      line.startsWith("@./") || line.startsWith("@/"),
      `GEMINI.md line ${JSON.stringify(line)} is not an @-reference (expected '@./...' or '@/...')`,
    );
    const ref = line.slice(1).replace(/^\.\//, "");
    assert(
      await pathExists(ref),
      `GEMINI.md references ${line} which does not resolve to an existing file`,
    );
  }
});

Deno.test("harness adapter — OpenCode JS adapter exports SpecflowPlugin", async () => {
  const raw = await Deno.readTextFile(abs(".opencode/plugins/specflow.js"));
  // Static-check: the adapter exports the expected named function.
  // We don't dynamically import (the file uses Node ESM with `fs` /
  // `path` / `url` imports that won't resolve under Deno).
  assert(
    /export\s+const\s+SpecflowPlugin\s*=/.test(raw),
    ".opencode/plugins/specflow.js must export `SpecflowPlugin`",
  );
  // Sanity: must reference the using-specflow bootstrap skill.
  assert(
    raw.includes("using-specflow"),
    ".opencode/plugins/specflow.js must reference the using-specflow bootstrap skill",
  );
  // Sanity: must register skills path into config.skills.paths.
  assert(
    raw.includes("config.skills.paths"),
    ".opencode/plugins/specflow.js must register skills path into config.skills.paths",
  );
});
