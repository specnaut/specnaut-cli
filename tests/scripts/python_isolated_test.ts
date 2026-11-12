import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, relative } from "@std/path";

/**
 * A bundled script that runs python3 does so in isolated mode (`-I`): without it, the
 * working directory comes first on sys.path, and a `json.py` in the project is imported
 * in place of the standard library. The population is every shipped shell script.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));

/** Each `python3` run in `text` (a `-c` program, or a script on stdin) not given `-I` first. */
export function unisolated(text: string): string[] {
  return [...text.matchAll(/\bpython3\s+(?!-I\b)-(?:c\b|\s|$)[^\n]*/gm)].map((m) => m[0]);
}

Deno.test("every shipped shell script runs python3 isolated", async () => {
  const found: string[] = [];
  for (const dir of ["templates", "plugin"]) {
    for await (const e of walk(`${ROOT}${dir}`, { includeDirs: false, exts: [".sh"] })) {
      for (const line of unisolated(await Deno.readTextFile(e.path))) {
        found.push(`${relative(ROOT, e.path).replaceAll("\\", "/")}: ${line.trim()}`);
      }
    }
  }
  assertEquals(found, []);
});

Deno.test("the matcher flags a bare run and passes an isolated one", () => {
  assertEquals(unisolated('x=$(python3 -c "import json")').length, 1);
  assertEquals(unisolated('V=1 python3 -c "x"').length, 1);
  assertEquals(unisolated('x=$(python3 -I -c "import json")'), []);
  assertEquals(unisolated("command -v python3 >/dev/null"), []);
  assertEquals(unisolated("# a Windows python3 ends a print with CRLF"), []);
  assertEquals(unisolated("python3 - <<'EOF'").length, 1);
});
