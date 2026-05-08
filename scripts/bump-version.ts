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

async function readCurrentVersion(): Promise<string> {
  const raw = await Deno.readTextFile("deno.json");
  const parsed = JSON.parse(raw) as { version: string };
  return parsed.version;
}

async function writeVersions(next: string): Promise<void> {
  const denoRaw = await Deno.readTextFile("deno.json");
  const updatedDeno = denoRaw.replace(
    /"version":\s*"[^"]+"/,
    `"version": "${next}"`,
  );
  await Deno.writeTextFile("deno.json", updatedDeno);

  const verPath = "src/domain/version.ts";
  const verRaw = await Deno.readTextFile(verPath);
  const updatedVer = verRaw.replace(
    /export const VERSION\s*=\s*"[^"]+"/,
    `export const VERSION = "${next}"`,
  );
  await Deno.writeTextFile(verPath, updatedVer);

  // Lockstep the claude-specflow plugin manifest (#73 slice 8). The
  // release workflow's pre-flight step compares deno.json `version`
  // against this file's `version` and fails fast on drift.
  const pluginManifestPath = "plugin/.claude-plugin/plugin.json";
  const pluginRaw = await Deno.readTextFile(pluginManifestPath);
  const updatedPlugin = pluginRaw.replace(
    /"version":\s*"[^"]+"/,
    `"version": "${next}"`,
  );
  await Deno.writeTextFile(pluginManifestPath, updatedPlugin);
}

async function main() {
  const [kind] = Deno.args;
  if (!kind) {
    console.error(
      "usage: deno run -A scripts/bump-version.ts <patch|minor|major|prerelease:<tag>>",
    );
    Deno.exit(2);
  }
  const version = await readCurrentVersion();
  const next = computeNextVersion(version, kind as BumpKind);
  await writeVersions(next);
  console.log(`Bumped ${version} → ${next}`);
  console.log(
    `Updated: deno.json, src/domain/version.ts, plugin/.claude-plugin/plugin.json`,
  );
}

if (import.meta.main) await main();
