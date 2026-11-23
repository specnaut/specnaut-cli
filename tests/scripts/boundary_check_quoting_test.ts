// cli#828: `boundary-check.sh` prints every value read from `boundaries.yml` and every path it
// reports through `c_quoted`, the size ratchet's quoting: printed raw, an escape sequence or a C1
// byte in one would act on the terminal. The reader refuses a C0 byte in a config line, so a
// value plants a C1 character (CSI, U+009B); a path plants an ESC.
//
// Every case requires the escaped spelling, which only the quoting can print, and no raw control
// byte anywhere in the output. Windows takes no control character in a file name.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { BOUNDARIES_CONFIG_PATH } from "../../src/domain/constitution_paths.ts";
import { quoted, run } from "./size_ratchet_fixture.ts";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";

const SCRIPT = bashPath(fromFileUrl(
  new URL("../../templates/core/specnaut/scripts/bash/boundary-check.sh", import.meta.url),
));
const CSI = "\u009b";
const VIOLATION = 'export const a = 1;\nimport x from "web-framework";\n';

/** A committed repo holding `files` and a `boundaries.yml` of single-quoted entries. */
async function check(files: Record<string, string>, domain: string[], forbid: string[]) {
  const dir = await Deno.makeTempDir({ prefix: "boundary-quoting-" });
  await run("git", ["init", "-q"], dir);
  for (const [path, content] of Object.entries({ "README.md": "a project\n", ...files })) {
    await Deno.mkdir(dirname(join(dir, path)), { recursive: true });
    await Deno.writeTextFile(join(dir, path), content);
  }
  const list = (key: string, values: string[]) =>
    `${key}:\n${values.map((v) => `  - '${v}'\n`).join("")}`;
  await Deno.mkdir(join(dir, ".specnaut"));
  await Deno.writeTextFile(
    join(dir, BOUNDARIES_CONFIG_PATH),
    list("domain", domain) + list("forbid", forbid),
  );
  await run("git", ["add", "-A"], dir);
  await run("git", ["commit", "-q", "-m", "init"], dir);
  const r = await run("bash", [SCRIPT], dir);
  const out = r.stdout + r.stderr;
  assert(!out.includes("\x1b") && !out.includes(CSI), out);
  return { ...r, out };
}

Deno.test("a violation names its path and its pattern escaped", {
  ignore: Deno.build.os === "windows",
}, async () => {
  const path = "src/domain/x\x1b[2J.ts";
  const pattern = `from "web-framework"(${CSI})?`;
  const r = await check({ [path]: VIOLATION }, ["src/domain"], [pattern]);
  assertEquals(r.code, 1, r.out);
  assertStringIncludes(r.stderr, `${quoted(path)}:2: ${quoted(pattern)}`);
  assertStringIncludes(r.stderr, '"src/domain/x\\033[2J.ts":2:');
});

Deno.test("a configured value is escaped in each line that names it", async () => {
  const files = { "src/domain/order.ts": "export const total = 1;\n" };
  const note = await check(files, ["src/domain", `src/${CSI}none`], ["web-framework"]);
  assertEquals(note.code, 0, note.out);
  assertStringIncludes(
    note.stdout,
    `domain: '"src/\\302\\233none"' (line 3) names no tracked file`,
  );

  const listed = await check(files, [`../${CSI}elsewhere`], ["web-framework"]);
  assertEquals(listed.code, 2, listed.out);
  assertStringIncludes(listed.stderr, `domain: '"../\\302\\233elsewhere"' cannot be listed`);

  const regex = await check(files, ["src/domain"], [`(${CSI}`]);
  assertEquals(regex.code, 2, regex.out);
  assertStringIncludes(regex.stderr, `forbid: '"(\\302\\233"' is not an extended regular`);
});
