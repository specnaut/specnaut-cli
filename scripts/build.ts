// Compiles specnaut for the five supported targets into dist/.
// Requires: deno task bundle to have been run first (deno task build does both).
//
// `--list-json` prints that table and nothing else (no permission needed), so
// a workflow builds its matrix and its expected asset list from it
// (`fromJSON`) instead of naming an asset itself.

import { fromFileUrl } from "@std/path";

const ROOT = new URL("..", import.meta.url);
const OUT = new URL("dist/", ROOT);
const ENTRY = fromFileUrl(new URL("src/main.ts", ROOT));

/**
 * `goos` is the target's OS family, which release.yml filters on to pick the
 * macOS binaries it signs; `runner` is the GitHub-hosted runner that executes
 * a binary natively (release.yml's macOS smoke test runs on it).
 */
type Target = { triple: string; goos: string; runner: string; outName: string };

/**
 * Exported so `verify-release.ts` checks exactly the set this compiler emits,
 * rather than re-deriving it by pattern-matching this file (cli#595). Safe to
 * import: `main()` is guarded by `import.meta.main` at the bottom.
 *
 * Deliberately phrased without quoting the field-and-quote pattern the release
 * gate greps for — spelling it here makes this comment match as a sixth target.
 */
export const TARGETS: Target[] = [
  {
    triple: "x86_64-apple-darwin",
    goos: "darwin",
    runner: "macos-15-intel",
    outName: "specnaut-macos-x64",
  },
  {
    triple: "aarch64-apple-darwin",
    goos: "darwin",
    runner: "macos-latest",
    outName: "specnaut-macos-arm64",
  },
  {
    triple: "x86_64-unknown-linux-gnu",
    goos: "linux",
    runner: "ubuntu-latest",
    outName: "specnaut-linux-x64",
  },
  {
    triple: "aarch64-unknown-linux-gnu",
    goos: "linux",
    runner: "ubuntu-24.04-arm",
    outName: "specnaut-linux-arm64",
  },
  {
    triple: "x86_64-pc-windows-msvc",
    goos: "windows",
    runner: "windows-latest",
    outName: "specnaut-windows-x64.exe",
  },
];

// Permissions baked into the binary. `--allow-net` is unscoped (no host
// allowlist) on purpose: the Cloud backend (`specnaut cloud login`, backlog
// sync) talks to a USER-CONFIGURABLE API host — the `api.specnaut.com`
// default, an `--api-url` flag for dev / self-hosted, or an `api_url` in
// `.specnaut/backlog-config.yml`. A compile-time host allowlist cannot know
// those, so any scoped list makes Deno prompt at runtime for every non-listed
// host (the exact UX we're removing). Scoping also buys almost nothing here:
// the binary already ships `--allow-run` + `--allow-ffi` + full read/write, so
// a tampered binary could exfiltrate via a subprocess regardless — the net
// allowlist was never a real trust boundary. self-update (api.github.com +
// the release-asset redirect hosts) is covered by the same open grant.
export const PERMISSIONS = [
  "--allow-read",
  "--allow-write",
  "--allow-run",
  "--allow-env",
  "--allow-net",
  // OS-native keychain for Cloud credentials (#360) reaches the platform secret
  // store via Deno FFI. If withheld, the keychain backends throw
  // PermissionDenied and credential storage degrades to the 0600 file fallback.
  "--allow-ffi",
];

async function ensureOutDir(): Promise<void> {
  await Deno.mkdir(OUT, { recursive: true });
}

async function compile(target: Target): Promise<void> {
  const out = fromFileUrl(new URL(target.outName, OUT));
  console.log(`→ ${target.triple}  (${target.outName})`);
  const cmd = new Deno.Command("deno", {
    args: [
      "compile",
      ...PERMISSIONS,
      "--target",
      target.triple,
      "--output",
      out,
      ENTRY,
    ],
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await cmd.output();
  if (!status.success) throw new Error(`Compile failed for ${target.triple}`);
}

async function main() {
  if (Deno.args.includes("--list-json")) {
    console.log(JSON.stringify(TARGETS));
    return;
  }
  await ensureOutDir();
  const only = Deno.args[0];
  for (const t of TARGETS) {
    if (only && only !== t.triple && only !== t.outName) continue;
    await compile(t);
  }
  console.log("\ndist/:");
  for await (const entry of Deno.readDir(OUT)) console.log(`  ${entry.name}`);
}

if (import.meta.main) await main();
