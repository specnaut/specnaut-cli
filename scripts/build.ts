// Compiles specnaut for the five supported targets into dist/.
// Requires: deno task bundle to have been run first (deno task build does both).

const ROOT = new URL("..", import.meta.url);
const OUT = new URL("dist/", ROOT);
const ENTRY = new URL("src/main.ts", ROOT).pathname;

type Target = { triple: string; outName: string };

const TARGETS: Target[] = [
  { triple: "x86_64-apple-darwin", outName: "specnaut-macos-x64" },
  { triple: "aarch64-apple-darwin", outName: "specnaut-macos-arm64" },
  { triple: "x86_64-unknown-linux-gnu", outName: "specnaut-linux-x64" },
  { triple: "aarch64-unknown-linux-gnu", outName: "specnaut-linux-arm64" },
  { triple: "x86_64-pc-windows-msvc", outName: "specnaut-windows-x64.exe" },
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
const PERMISSIONS = [
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
  const out = new URL(target.outName, OUT).pathname;
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
