// Compiles specflow for the five v0.1 targets into dist/.
// Requires: deno task bundle to have been run first (deno task build does both).

const ROOT = new URL("..", import.meta.url);
const OUT = new URL("dist/", ROOT);
const ENTRY = new URL("src/main.ts", ROOT).pathname;

type Target = { triple: string; outName: string };

const TARGETS: Target[] = [
  { triple: "x86_64-apple-darwin", outName: "specflow-macos-x64" },
  { triple: "aarch64-apple-darwin", outName: "specflow-macos-arm64" },
  { triple: "x86_64-unknown-linux-gnu", outName: "specflow-linux-x64" },
  { triple: "aarch64-unknown-linux-gnu", outName: "specflow-linux-arm64" },
  { triple: "x86_64-pc-windows-msvc", outName: "specflow-windows-x64.exe" },
];

// Permissions baked into the binary. --allow-net is required by
// `specflow self-update` (Task 15) to reach api.github.com. Scoped to the
// GitHub API + release download hosts only.
const PERMISSIONS = [
  "--allow-read",
  "--allow-write",
  "--allow-run",
  "--allow-env",
  "--allow-net=api.github.com,github.com,objects.githubusercontent.com,codeload.github.com",
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
