// Bumps deno.json and src/domain/version.ts in lockstep with a semver action.
// Pure `computeNextVersion` is exported for testability.

import { SemVer } from "../src/domain/release.ts";

export type BumpKind =
  | "patch"
  | "minor"
  | "major"
  | `prerelease:${string}`;

export function computeNextVersion(current: string, kind: BumpKind): string {
  const v = SemVer.parse(current);
  if (kind === "patch") {
    // If already a prerelease of the same patch, just drop the suffix
    if (v.prerelease) return `${v.major}.${v.minor}.${v.patch}`;
    return bump(v, 0, 0, 1);
  }
  if (kind === "minor") return bump(v, 0, 1, 0);
  if (kind === "major") return bump(v, 1, 0, 0);
  if (kind.startsWith("prerelease:")) {
    const tag = kind.slice("prerelease:".length);
    if (v.prerelease && v.prerelease.startsWith(`${tag}.`)) {
      const n = Number(v.prerelease.slice(tag.length + 1));
      return `${v.major}.${v.minor}.${v.patch}-${tag}.${n + 1}`;
    }
    // first prerelease of the next patch
    return `${v.major}.${v.minor}.${v.patch + 1}-${tag}.1`;
  }
  throw new Error(`Unknown bump kind: ${kind}`);
}

function bump(
  v: SemVer,
  majorDelta: number,
  minorDelta: number,
  patchDelta: number,
): string {
  const major = v.major + majorDelta;
  const minor = majorDelta > 0 ? 0 : v.minor + minorDelta;
  const patch = majorDelta > 0 || minorDelta > 0 ? 0 : v.patch + patchDelta;
  return `${major}.${minor}.${patch}`;
}

// File targets that all four version fields live in. Exported so tests can
// assert the same set the bump script writes to, and so `writeVersions`
// stays single-source-of-truth.
export const VERSIONED_FILES = [
  "deno.json",
  "src/domain/version.ts",
  "plugin/.claude-plugin/plugin.json",
  "templates/manifest.json",
  ".codex-plugin/plugin.json",
  ".cursor-plugin/plugin.json",
] as const;

async function readCurrentVersion(baseDir: string): Promise<string> {
  const raw = await Deno.readTextFile(`${baseDir}/deno.json`);
  const parsed = JSON.parse(raw) as { version: string };
  return parsed.version;
}

export async function writeVersions(
  next: string,
  baseDir: string = ".",
): Promise<void> {
  const denoRaw = await Deno.readTextFile(`${baseDir}/deno.json`);
  const updatedDeno = denoRaw.replace(
    /"version":\s*"[^"]+"/,
    `"version": "${next}"`,
  );
  await Deno.writeTextFile(`${baseDir}/deno.json`, updatedDeno);

  const verPath = `${baseDir}/src/domain/version.ts`;
  const verRaw = await Deno.readTextFile(verPath);
  const updatedVer = verRaw.replace(
    /export const VERSION\s*=\s*"[^"]+"/,
    `export const VERSION = "${next}"`,
  );
  await Deno.writeTextFile(verPath, updatedVer);

  // Lockstep the specnaut-plugin plugin manifest (#73 slice 8). The
  // release workflow's pre-flight step compares deno.json `version`
  // against this file's `version` and fails fast on drift.
  const pluginManifestPath = `${baseDir}/plugin/.claude-plugin/plugin.json`;
  const pluginRaw = await Deno.readTextFile(pluginManifestPath);
  const updatedPlugin = pluginRaw.replace(
    /"version":\s*"[^"]+"/,
    `"version": "${next}"`,
  );
  await Deno.writeTextFile(pluginManifestPath, updatedPlugin);

  // Lockstep the templates manifest. `TEMPLATES_VERSION` in
  // `src/templates_bundle.ts` is regenerated from this file by
  // `deno task bundle`, and it's what the binary surfaces under
  // `specnaut --version` (the "templates X.Y.Z" suffix). Skipping
  // this bump leaves a cosmetic drift visible to every user.
  const templatesManifestPath = `${baseDir}/templates/manifest.json`;
  const templatesRaw = await Deno.readTextFile(templatesManifestPath);
  const updatedTemplates = templatesRaw.replace(
    /"version":\s*"[^"]+"/,
    `"version": "${next}"`,
  );
  await Deno.writeTextFile(templatesManifestPath, updatedTemplates);

  // Lockstep the Codex plugin manifest (Epic #270 / B1 #277). The
  // release workflow's pre-flight step compares deno.json `version`
  // against this file's `version` too — drift here blocks the build.
  const codexManifestPath = `${baseDir}/.codex-plugin/plugin.json`;
  const codexRaw = await Deno.readTextFile(codexManifestPath);
  const updatedCodex = codexRaw.replace(
    /"version":\s*"[^"]+"/,
    `"version": "${next}"`,
  );
  await Deno.writeTextFile(codexManifestPath, updatedCodex);

  // Lockstep the Cursor plugin manifest (Epic #270 / B2 #278). Same
  // pre-flight drift gate as the Codex manifest; Cursor users install
  // directly from the repo so the manifest's version must match.
  const cursorManifestPath = `${baseDir}/.cursor-plugin/plugin.json`;
  const cursorRaw = await Deno.readTextFile(cursorManifestPath);
  const updatedCursor = cursorRaw.replace(
    /"version":\s*"[^"]+"/,
    `"version": "${next}"`,
  );
  await Deno.writeTextFile(cursorManifestPath, updatedCursor);
}

async function main() {
  const [kind] = Deno.args;
  if (!kind) {
    console.error(
      "usage: deno run -A scripts/bump-version.ts <patch|minor|major|prerelease:<tag>>",
    );
    Deno.exit(2);
  }
  const version = await readCurrentVersion(".");
  const next = computeNextVersion(version, kind as BumpKind);
  await writeVersions(next);
  console.log(`Bumped ${version} → ${next}`);
  console.log(`Updated: ${VERSIONED_FILES.join(", ")}`);
}

if (import.meta.main) await main();
