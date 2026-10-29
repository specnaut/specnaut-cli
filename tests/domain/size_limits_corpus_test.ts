import { assertEquals } from "@std/assert";
import { basename, fromFileUrl, join } from "@std/path";
import {
  readSizeLimits,
  type SizeConfig,
  sizeConfigFromEntry,
  sizeLimitsYaml,
} from "../../src/domain/size_limits.ts";

/**
 * Spec 038 (A-M3, A-L4, S4): `.specnaut/size-limits.yml` has two readers —
 * `config_size_limits` in `_config.sh`, which the ratchet gates on, and
 * `readSizeLimits`, which `check` and `upgrade` warn from. One corpus, one
 * expected answer per file, asserted against BOTH: a file one reader takes and
 * the other refuses is a gate and a warning that disagree about the project.
 *
 * An expected file is the canonical dump `config_size_limits` prints, or
 * `unreadable: <reason>` — the reason too, so the two readers name the same
 * first fault and not merely both fail.
 */

const CORPUS = fromFileUrl(new URL("../fixtures/size_limits/", import.meta.url));
const CONFIG_SH = fromFileUrl(
  new URL("../../templates/core/specnaut/scripts/bash/_config.sh", import.meta.url),
);
const isWindows = Deno.build.os === "windows";
const lf = (s: string) => s.replaceAll("\r\n", "\n");

/** The TypeScript answer, in the bash reader's canonical form. */
export function tsDump(config: SizeConfig): string {
  if (config.kind === "unreadable") return `unreadable: ${config.reason}\n`;
  const v = (n: number | null) => n === null ? "none" : String(n);
  const { units, exempt } = config.limits;
  return Object.entries(units).map(([u, l]) => `${u} ${v(l.target)} ${v(l.ceiling)} ${l.source}\n`)
    .join("") + exempt.map((g) => `exempt ${g}\n`).join("");
}

/** The bash answer for the config at `path`. */
async function bashDump(path: string): Promise<string> {
  const script = '. "$1"; out="$(config_size_limits "$2")"; rc=$?; ' +
    'if [ "$rc" = 2 ]; then printf "unreadable: %s\\n" "$out"; ' +
    'elif [ "$rc" = 0 ]; then printf "%s\\n" "$out"; else echo "exit $rc"; fi';
  const { stdout, stderr } = await new Deno.Command("bash", {
    args: ["-c", script, "_", CONFIG_SH, path],
    stdout: "piped",
    stderr: "piped",
  }).output();
  return new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr);
}

async function corpus(): Promise<{ name: string; yml: string; expected: string }[]> {
  const out = [];
  for await (const e of Deno.readDir(CORPUS)) {
    if (!e.name.endsWith(".yml")) continue;
    const name = basename(e.name, ".yml");
    out.push({
      name,
      yml: join(CORPUS, e.name),
      expected: lf(await Deno.readTextFile(join(CORPUS, `${name}.expected`))),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Cases a checked-out file cannot hold reliably: an autocrlf checkout rewrites line ends. */
async function generated(): Promise<{ name: string; text: string; expected: string }[]> {
  const full = (await corpus()).find((c) => c.name === "full")!;
  return [
    {
      name: "crlf",
      text: lf(await Deno.readTextFile(full.yml)).replaceAll("\n", "\r\n"),
      expected: full.expected,
    },
    {
      name: "bare carriage return",
      text: "file:\n  target: 300\r  ceiling: 500\n",
      expected: "unreadable: line 2: a carriage return inside a line\n",
    },
  ];
}

Deno.test("the corpus covers every reject case the plan names", async () => {
  const names = new Set((await corpus()).map((c) => c.name));
  for (
    const n of ["flow_map", "tab", "comments", "none", "duplicate_key", "bad_value", "alias"]
  ) assertEquals(names.has(n), true, n);
});

Deno.test("the TypeScript reader gives every corpus file its expected answer", async () => {
  for (const c of await corpus()) {
    assertEquals(tsDump(readSizeLimits(await Deno.readTextFile(c.yml))), c.expected, c.name);
  }
  for (const g of await generated()) assertEquals(tsDump(readSizeLimits(g.text)), g.expected);
});

Deno.test("the bash reader gives every corpus file the same answer", {
  ignore: isWindows,
}, async () => {
  for (const c of await corpus()) assertEquals(await bashDump(c.yml), c.expected, c.name);
  const dir = await Deno.makeTempDir();
  for (const g of await generated()) {
    const path = join(dir, "size-limits.yml");
    await Deno.writeTextFile(path, g.text);
    assertEquals(await bashDump(path), g.expected, g.name);
  }
});

Deno.test("no file is the defaults, for both readers", { ignore: isWindows }, async () => {
  const defaults = lf(await Deno.readTextFile(join(CORPUS, "empty.expected")));
  assertEquals(tsDump(readSizeLimits(null)), defaults);
  assertEquals(await bashDump(join(await Deno.makeTempDir(), "absent.yml")), defaults);
});

Deno.test("a link at the config path is unreadable for both, dangling or not", {
  ignore: isWindows,
}, async () => {
  const dir = await Deno.makeTempDir();
  const link = join(dir, "size-limits.yml");
  await Deno.symlink(join(dir, "nowhere.yml"), link);
  const reason = "unreadable: is a link — the config is read only from a regular file\n";
  assertEquals(await bashDump(link), reason);
  assertEquals(
    tsDump(sizeConfigFromEntry({ kind: "symlink", target: "x", resolved: null })),
    reason,
  );
});

Deno.test("what the extraction writes, both readers read back as written", {
  ignore: isWindows,
}, async () => {
  const text = sizeLimitsYaml(
    { file: { target: 250, ceiling: null }, constitution: { target: 70, ceiling: 110 } },
    ["*.lock", "docs/a b/**", "x # y"],
  );
  const expected = "file 250 none config\nfunction 30 50 default\nconstitution 70 110 config\n" +
    "exempt *.lock\nexempt docs/a b/**\nexempt x # y\n";
  assertEquals(tsDump(readSizeLimits(text)), expected);
  const path = join(await Deno.makeTempDir(), "size-limits.yml");
  await Deno.writeTextFile(path, text);
  assertEquals(await bashDump(path), expected);
});
