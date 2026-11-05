// SC-001 (cli#747): generates a synthetic repository and records how long `specnaut scan` takes on
// it, warm cache. A recorded run, never a CI timing gate.
//
//   deno run --allow-read --allow-write --allow-run --allow-env scripts/scan-bench.ts <dir> \
//     [--files 100000] [--bytes 1500000000] [--bin <specnaut binary>]
//
// <dir> must not exist. Without --bin the scan runs from source. The content is invented: a mix of
// TypeScript with functions and classes, Python, Markdown, shell, a few files over the 1 MiB read
// cap and a few binaries, spread over nested folders, with an `exempt:` list of twenty globs and a
// `.gitattributes` marking some of them binary, so the matcher and check-attr are both on the clock.
import { parseArgs } from "@std/cli/parse-args";
import { dirname, fromFileUrl, join } from "@std/path";
import { sizeLimitsYaml } from "../src/domain/size_limits.ts";

const args = parseArgs(Deno.args, { string: ["files", "bytes", "bin"] });
const dir = String(args._[0] ?? "");
if (dir === "") throw new Error("usage: scan-bench.ts <dir> [--files N] [--bytes N] [--bin path]");
const files = Number(args.files ?? 100_000);
const bytes = Number(args.bytes ?? 1_500_000_000);

const TS_UNIT = "export class Box {\n  get(): number {\n    return 1;\n  }\n}\n" +
  "export function run(a: number): number {\n  const b = a * 2;\n  return b + 1;\n}\n";
const KINDS = [
  { ext: "ts", unit: TS_UNIT },
  {
    ext: "py",
    unit: "class Box:\n    def get(self):\n        return 1\n\n\ndef run(a):\n    return a * 2\n",
  },
  { ext: "md", unit: "# Title\n\nSome prose about nothing in particular.\n\n" },
  { ext: "sh", unit: 'run() {\n  echo "x"\n}\n' },
];

/** The i-th file's path: three levels of folders, so the tree and the folder map are exercised. */
const pathOf = (i: number, ext: string) => `p${i % 10}/m${i % 97}/l${i % 31}/f${i}.${ext}`;

async function generate(): Promise<void> {
  const average = Math.floor(bytes / files);
  for (let i = 0; i < files; i++) {
    const kind = KINDS[i % KINDS.length];
    // Every 2000th file is over the read cap, every 997th is binary.
    const size = i % 2000 === 0 ? 3 * 1024 * 1024 : average;
    const body = i % 997 === 0
      ? "\0binary\n"
      : kind.unit.repeat(Math.max(1, Math.ceil(size / kind.unit.length)));
    const path = join(dir, pathOf(i, kind.ext));
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, body.slice(0, Math.max(size, 8)));
  }
}

async function run(
  cmd: string,
  argv: string[],
  cwd = dir,
): Promise<{ ms: number; out: string; code: number }> {
  const started = performance.now();
  const r = await new Deno.Command(cmd, { args: argv, cwd, stdout: "piped", stderr: "inherit" })
    .output();
  return { ms: performance.now() - started, out: new TextDecoder().decode(r.stdout), code: r.code };
}

/** Twenty globs a project might hold; a few of them take generated files, most take none. */
// deno-fmt-ignore
const EXEMPT = [
  "*.lock", "*.min.js", "dist/*", "build/*", "vendor/*", "node_modules/*", "*.generated.ts",
  "*_pb.go", "*.snap", "coverage/*", "*.svg", "*.map", "/docs/api/*", "*.pb.ts", "third_party/*",
  "p3/m1*", "*/l7/*", "*.[ch]pp", "p8/m?/l2/*", "*fixture*",
];

/** The config and the attributes, written beside the generated files before the commit. */
async function configure(): Promise<void> {
  await Deno.mkdir(join(dir, ".specnaut"));
  await Deno.writeTextFile(join(dir, ".specnaut/size-limits.yml"), sizeLimitsYaml({}, EXEMPT));
  await Deno.writeTextFile(join(dir, ".gitattributes"), "p9/m1/** -diff\n*.sh text diff\n");
}

/** A setup step that must succeed, or the timing would measure a broken repository. */
async function mustRun(argv: string[]): Promise<void> {
  const r = await run("git", [
    "-c",
    "user.name=bench",
    "-c",
    "user.email=bench@example.com",
    ...argv,
  ]);
  if (r.code !== 0) throw new Error(`git ${argv.join(" ")} exited ${r.code}`);
}

await Deno.mkdir(dir);
await generate();
await configure();
await mustRun(["init", "-q"]);
await mustRun(["add", "-A"]);
await mustRun(["commit", "-q", "-m", "bench"]);
const main = fromFileUrl(new URL("../src/main.ts", import.meta.url));
const scan = args.bin ? () => run(args.bin!, ["scan", "--format", "json"]) : () =>
  run("deno", [
    "run",
    "--allow-read",
    "--allow-write",
    "--allow-run",
    "--allow-env",
    main,
    "scan",
    "--format",
    "json",
  ]);
await scan(); // warm the cache
const timed = await scan();
const totals = JSON.parse(timed.out).totals;
console.log(
  JSON.stringify({
    files,
    bytes,
    exit: timed.code,
    seconds: +(timed.ms / 1000).toFixed(2),
    totals,
  }),
);
