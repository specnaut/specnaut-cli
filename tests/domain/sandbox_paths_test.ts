import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  ancestors,
  HOME_TOOLCHAINS,
  layoutProblem,
  overlaps,
  pathProblem,
  safePath,
  within,
} from "../../src/domain/sandbox_paths.ts";

import { PATHS } from "./sandbox_fixture.ts";

/** How sandbox paths relate: what lies above them, and what one holds of another. */

Deno.test("ancestors: every folder above each path, the root included, once and sorted", () => {
  assertEquals(ancestors(["/a/b/c"]), ["/", "/a", "/a/b"]);
  assertEquals(ancestors(["/a/b/c", "/a/d"]), ["/", "/a", "/a/b"]);
  assertEquals(ancestors(["/x"]), ["/"]);
  assertEquals(ancestors([]), []);
});

Deno.test("within: a sibling sharing a prefix is not inside", () => {
  assertEquals(within("/home/devtools", "/home/dev"), false);
  assertEquals(within("/home/dev", "/home/devtools"), false);
  assertEquals(within("/home/dev-x/a", "/home/dev"), false);
  assertEquals(within("/home/dev", "/home/dev"), true);
  assertEquals(within("/home/dev/a", "/home/dev"), true);
  assertEquals(within("/home", "/home/dev"), false);
});

Deno.test("overlaps: either way round, never across a shared prefix", () => {
  assertEquals(overlaps("/home/dev", "/home/devtools"), false);
  assertEquals(overlaps("/home/devtools/a", "/home/dev"), false);
  assertEquals(overlaps("/home", "/home/dev"), true);
  assertEquals(overlaps("/home/dev/a", "/home/dev"), true);
});

Deno.test("pathProblem: one reason for each way a path cannot be passed on", () => {
  assertEquals(pathProblem("home/dev"), "is not absolute");
  for (const bad of ['/a"b', "/a\\b", "/a,b", "/a:b", "/a\nb", "/a\u0000", "/a\u007f"]) {
    assertEquals(pathProblem(bad), "holds a character a backend cannot quote", JSON.stringify(bad));
  }
  assertEquals(pathProblem("/"), "is the root folder");
  for (const bad of ["/a/../b", "/a/./b", "/a//b", "/a/b/"]) {
    assertEquals(pathProblem(bad), "is not in plain form", bad);
  }
  assertEquals(pathProblem("/home/dev/.cache/x"), null);
});

Deno.test("safePath: hands a plain path back, and throws with the reason otherwise", () => {
  assertEquals(safePath("/usr/bin"), "/usr/bin");
  assertThrows(() => safePath("/a,b"), Error, "cannot quote");
});

/**
 * Every folder under the home a sandbox may read, written out: an entry dropped from the list, or
 * one added, fails. `*` is a version.
 */
const TOOLCHAINS = [
  ".cargo/bin",
  ".rustup/toolchains",
  ".deno/bin",
  ".bun/bin",
  "go/bin",
  ".local/bin",
  ".local/share/pipx/venvs",
  ".local/share/uv/tools",
  ".local/share/uv/python",
  ".nvm/versions/node/*/bin",
  ".nvm/versions/node/*/lib",
];

const readOnly = (folder: string) => layoutProblem(PATHS, [PATHS.tree, folder], []);

Deno.test("layoutProblem: the home's toolchain folders are the ones stated", () => {
  assertEquals([...HOME_TOOLCHAINS], TOOLCHAINS);
});

for (const entry of TOOLCHAINS) {
  Deno.test(`layoutProblem: ~/${entry} is read, and a folder inside it`, () => {
    const folder = `${PATHS.home}/${entry.replace("*", "v22.11.0")}`;
    assertEquals(readOnly(folder), null);
    assertEquals(readOnly(`${folder}/x86_64/bin`), null);
  });
}

Deno.test("layoutProblem: any other folder under the home is refused, credential folders among them", () => {
  const others = [
    ".ssh",
    ".aws",
    ".config",
    ".cargo",
    ".local",
    ".local/share",
    ".nvm/versions/node",
    ".nvm/versions/node/v22.11.0",
    ".nvm/versions/node/v22.11.0/etc",
    "Library/Keychains",
    "tools/bin",
    ".deno",
    ".deno/binaries",
  ];
  for (const other of others) {
    const folder = `${PATHS.home}/${other}`;
    const why = readOnly(folder) ?? "read";
    assertStringIncludes(why, `${folder} is in the home folder`, other);
    assertStringIncludes(why, "~/.cargo/bin, ~/.rustup/toolchains", other);
  }
});

Deno.test("layoutProblem: the tree and the scratch, made in a cache in the home, are let be", () => {
  // Both are the caller's own folders, made in its cache: the list judges what else is read.
  assertEquals(layoutProblem(PATHS, [PATHS.tree], []), null);
  const beside = `${PATHS.home}/.cache/specnaut/sandbox/abc/other`;
  assertStringIncludes(readOnly(beside) ?? "read", `${beside} is in the home folder`);
});
