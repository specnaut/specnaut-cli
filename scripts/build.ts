// Compiles specnaut for the five supported targets into dist/.
// Requires: deno task bundle to have been run first (deno task build does both).
//
// `--go` builds the Go port (cli#662) for the same targets, under the same
// asset names, with cgo off: `deno run --allow-read --allow-write --allow-run
// --allow-env scripts/build.ts --go [<target>]`. One target table for both
// languages, so a dry run cannot drift from the release.
//
// `--list-json` prints that table and nothing else (no permission needed), so
// a workflow builds its matrix and its expected asset list from it
// (`fromJSON`) instead of naming an asset itself.

const ROOT = new URL("..", import.meta.url);
const OUT = new URL("dist/", ROOT);
const ENTRY = new URL("src/main.ts", ROOT).pathname;

/**
 * `goos`/`goarch` are the Go port's coordinates for the same target; `runner`
 * is the GitHub-hosted runner that executes it natively (the dry run measures
 * each binary on its own platform).
 */
type Target = { triple: string; goos: string; goarch: string; runner: string; outName: string };

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
    goarch: "amd64",
    runner: "macos-15-intel",
    outName: "specnaut-macos-x64",
  },
  {
    triple: "aarch64-apple-darwin",
    goos: "darwin",
    goarch: "arm64",
    runner: "macos-latest",
    outName: "specnaut-macos-arm64",
  },
  {
    triple: "x86_64-unknown-linux-gnu",
    goos: "linux",
    goarch: "amd64",
    runner: "ubuntu-latest",
    outName: "specnaut-linux-x64",
  },
  {
    triple: "aarch64-unknown-linux-gnu",
    goos: "linux",
    goarch: "arm64",
    runner: "ubuntu-24.04-arm",
    outName: "specnaut-linux-arm64",
  },
  {
    triple: "x86_64-pc-windows-msvc",
    goos: "windows",
    goarch: "amd64",
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

/**
 * The Go build of one target. `CGO_ENABLED=0` is the point of the port (no
 * C toolchain per target, no FFI), and `-trimpath` keeps the builder's paths
 * out of the binary. Exported so a test can pin the command without running
 * a toolchain.
 */
export function goBuildCommand(target: Target): { args: string[]; env: Record<string, string> } {
  return {
    args: ["build", "-trimpath", "-o", `dist/${target.outName}`, "./cmd/specnaut"],
    env: { CGO_ENABLED: "0", GOOS: target.goos, GOARCH: target.goarch },
  };
}

async function compileGo(target: Target): Promise<void> {
  const { args, env } = goBuildCommand(target);
  console.log(`→ ${target.goos}/${target.goarch}  (${target.outName}, go)`);
  const status = await new Deno.Command("go", {
    args,
    env,
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!status.success) throw new Error(`Go build failed for ${target.goos}/${target.goarch}`);
}

async function main() {
  if (Deno.args.includes("--list-json")) {
    console.log(JSON.stringify(TARGETS));
    return;
  }
  await ensureOutDir();
  const go = Deno.args.includes("--go");
  const only = Deno.args.find((a) => a !== "--go");
  for (const t of TARGETS) {
    if (only && only !== t.triple && only !== t.outName) continue;
    await (go ? compileGo(t) : compile(t));
  }
  console.log("\ndist/:");
  for await (const entry of Deno.readDir(OUT)) console.log(`  ${entry.name}`);
}

if (import.meta.main) await main();
