// `boundary-check.sh` holds the project's domain paths free of the imports it
// forbids (spec 038, FR-011). The settings come from `.specnaut/boundaries.yml`;
// the grammar itself is `_config.sh`'s, pinned by the size-limits corpus.
//
// Every clean run below also requires the script's own success line, which
// only the path that grepped the tracked files can print, and every skip
// requires its reason: exit 4 is a fact distinct from a pass, and a test that
// accepted any exit-0 output would let the two blur.
//
// On Windows only the cases that plant a symlink are ignored, for the reason
// stated on `symlinkUnsure` in `size_ratchet_fixture.ts`.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { BOUNDARIES_CONFIG_PATH } from "../../src/domain/constitution_paths.ts";
import { run, symlinkUnsure } from "./size_ratchet_fixture.ts";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";

const SCRIPT = bashPath(fromFileUrl(
  new URL("../../templates/core/specnaut/scripts/bash/boundary-check.sh", import.meta.url),
));
const check = (dir: string) => run("bash", [SCRIPT], dir);
const CLEAN = "clean of";

/** A `boundaries.yml` from its three lists; an empty list is left out. */
const config = (domain: string[], forbid: string[], exempt: string[] = []) =>
  ([["domain", domain], ["forbid", forbid], ["exempt", exempt]] as const)
    .filter(([, values]) => values.length > 0)
    .map(([key, values]) => `${key}:\n${values.map((v) => `  - '${v}'\n`).join("")}`)
    .join("");

/** A committed repo holding `files` (path → content) and the config given. */
async function repo(files: Record<string, string>, cfg?: string): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "boundary-check-" });
  await run("git", ["init", "-q"], dir);
  await Deno.writeTextFile(join(dir, "README.md"), "a project\n");
  for (const [path, content] of Object.entries(files)) {
    await Deno.mkdir(dirname(join(dir, path)), { recursive: true });
    await Deno.writeTextFile(join(dir, path), content);
  }
  if (cfg !== undefined) {
    await Deno.mkdir(join(dir, ".specnaut"), { recursive: true });
    await Deno.writeTextFile(join(dir, BOUNDARIES_CONFIG_PATH), cfg);
  }
  await run("git", ["add", "-A"], dir);
  await run("git", ["commit", "-q", "-m", "init"], dir);
  return dir;
}

const DOMAIN = ["src/domain"];
const FORBID = ['^import .* from "web-framework"'];
const VIOLATION = 'export const a = 1;\nimport x from "web-framework";\n';

Deno.test("a domain free of the forbidden imports passes, and says what it checked", async () => {
  const dir = await repo(
    { "src/domain/order.ts": "export const total = 1;\n", "src/web/app.ts": VIOLATION },
    config(DOMAIN, FORBID),
  );
  const r = await check(dir);
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertStringIncludes(r.stdout, `boundary-check: 1 file(s) under domain: ${CLEAN} 1 pattern(s)`);
});

Deno.test("a forbidden import fails, as file:line: pattern", async () => {
  const dir = await repo({ "src/domain/order.ts": VIOLATION }, config(DOMAIN, FORBID));
  const r = await check(dir);
  assertEquals(r.code, 1, r.stdout + r.stderr);
  assertStringIncludes(r.stderr, `src/domain/order.ts:2: ${FORBID[0]}`);
  assert(!r.stdout.includes(CLEAN));
});

Deno.test("each reason to skip exits 4 with the reason, never 0", async () => {
  const cases: Array<[string, string | undefined, string]> = [
    ["no config", undefined, `no ${BOUNDARIES_CONFIG_PATH}`],
    ["no patterns", config(DOMAIN, []), "no forbid: patterns"],
    ["no domain", config([], FORBID), "no domain: paths"],
    ["no files", config(["src/missing"], FORBID), "no tracked file under domain:"],
    [
      "all exempt",
      config(DOMAIN, FORBID, ["src/domain/*"]),
      "every tracked file under domain: is exempt",
    ],
  ];
  for (const [name, cfg, reason] of cases) {
    const dir = await repo({ "src/domain/order.ts": VIOLATION }, cfg);
    const r = await check(dir);
    assertEquals(r.code, 4, `${name}: ${r.stdout}${r.stderr}`);
    assertStringIncludes(r.stdout, `boundary-check: skipped — ${reason}`, name);
    assert(!r.stdout.includes(CLEAN), name);
  }
});

Deno.test("an unreadable config, a link at its path, or a bad pattern exits 2", {
  ignore: symlinkUnsure,
}, async () => {
  const files = { "src/domain/order.ts": VIOLATION };
  const tab = await repo(files, "domain:\n\t- src/domain\nforbid:\n  - x\n");
  const t = await check(tab);
  assertEquals(t.code, 2, t.stdout + t.stderr);
  assertStringIncludes(t.stderr, `${BOUNDARIES_CONFIG_PATH}: line 2: a tab`);

  const link = await repo(files);
  await Deno.mkdir(join(link, ".specnaut"));
  await Deno.symlink("../README.md", join(link, BOUNDARIES_CONFIG_PATH));
  const l = await check(link);
  assertEquals(l.code, 2, l.stdout + l.stderr);
  assertStringIncludes(l.stderr, "is a link");

  const bad = await repo(files, config(DOMAIN, ["(unbalanced"]));
  const b = await check(bad);
  assertEquals(b.code, 2, b.stdout + b.stderr);
  assertStringIncludes(b.stderr, "line 4: forbid: '(unbalanced' is not an extended regular");
});

Deno.test("a non-ASCII file name is read and reported verbatim", async () => {
  const dir = await repo({ "src/domain/café.ts": VIOLATION }, config(DOMAIN, FORBID));
  const r = await check(dir);
  assertEquals(r.code, 1, r.stdout + r.stderr);
  assertStringIncludes(r.stderr, "src/domain/café.ts:2:");
});

Deno.test("a pattern starting with - is a pattern, not an option", async () => {
  const dir = await repo(
    { "src/domain/order.ts": "a\nrun --unsafe here\n" },
    config(DOMAIN, ["--unsafe"]),
  );
  const r = await check(dir);
  assertEquals(r.code, 1, r.stdout + r.stderr);
  assertStringIncludes(r.stderr, "src/domain/order.ts:2: --unsafe");
});

Deno.test("a symlink, committed or in the work tree, is never followed out of the repo", {
  ignore: symlinkUnsure,
}, async () => {
  const outside = await Deno.makeTempDir({ prefix: "boundary-outside-" });
  const target = join(outside, "secret.ts");
  await Deno.writeTextFile(target, VIOLATION);
  const dir = await repo(
    { "src/domain/order.ts": "export const total = 1;\n", "src/domain/later.ts": "ok\n" },
    config(DOMAIN, FORBID),
  );
  await Deno.symlink(target, join(dir, "src/domain/link.ts"));
  await run("git", ["add", "src/domain/link.ts"], dir);
  await run("git", ["commit", "-q", "-m", "a link"], dir);
  // A tracked regular file the work tree has since swapped for a link.
  await Deno.remove(join(dir, "src/domain/later.ts"));
  await Deno.symlink(target, join(dir, "src/domain/later.ts"));
  const r = await check(dir);
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertStringIncludes(r.stdout, `1 file(s) under domain: ${CLEAN}`);
});

Deno.test("only regular files are read: a submodule under the domain is not", async () => {
  const dir = await repo(
    { "src/domain/order.ts": "export const total = 1;\n" },
    config(DOMAIN, FORBID),
  );
  const head = (await run("git", ["rev-parse", "HEAD"], dir)).stdout.trim();
  // A gitlink (mode 160000): in the work tree it is a directory grep cannot read.
  await Deno.mkdir(join(dir, "src/domain/vendor"));
  await run(
    "git",
    ["update-index", "--add", "--cacheinfo", `160000,${head},src/domain/vendor`],
    dir,
  );
  const r = await check(dir);
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertStringIncludes(r.stdout, `1 file(s) under domain: ${CLEAN}`);
});

Deno.test("a domain path outside the repo exits 2, never a skip", async () => {
  const dir = await repo({ "src/domain/order.ts": VIOLATION }, config(["../elsewhere"], FORBID));
  const r = await check(dir);
  assertEquals(r.code, 2, r.stdout + r.stderr);
  assertStringIncludes(r.stderr, "domain: '../elsewhere' cannot be listed");
});

Deno.test("an exempt glob keeps a file out of the check", async () => {
  const dir = await repo(
    { "src/domain/order.ts": "export const total = 1;\n", "src/domain/schema.gen.ts": VIOLATION },
    config(DOMAIN, FORBID, ["*.gen.ts"]),
  );
  const r = await check(dir);
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertStringIncludes(r.stdout, `1 file(s) under domain: ${CLEAN}`);
});

Deno.test("a file grep cannot read exits 2, never a pass", async () => {
  const dir = await repo(
    { "src/domain/order.ts": "export const total = 1;\n" },
    config(DOMAIN, FORBID),
  );
  // The index still names a regular file; the work tree holds a directory.
  await Deno.remove(join(dir, "src/domain/order.ts"));
  await Deno.mkdir(join(dir, "src/domain/order.ts"));
  const r = await check(dir);
  assertEquals(r.code, 2, r.stdout + r.stderr);
  assertStringIncludes(r.stderr, "src/domain/order.ts: grep could not read it");
  assert(!r.stdout.includes(CLEAN));
});
