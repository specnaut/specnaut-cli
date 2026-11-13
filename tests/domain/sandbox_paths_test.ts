import { assertEquals, assertThrows } from "@std/assert";
import {
  ancestors,
  CREDENTIAL_LOCATIONS,
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

/** Every place in a home credentials are kept, written out: a location dropped from the list fails. */
const CREDENTIALS = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".cargo",
  ".config",
  ".docker",
  ".kube",
  ".netrc",
  ".npmrc",
  ".git-credentials",
];

const readOnly = (folder: string) => layoutProblem(PATHS, [PATHS.tree, folder], []);

for (const location of CREDENTIALS) {
  Deno.test(`layoutProblem: ~/${location} is never mounted read-only`, () => {
    const folder = `${PATHS.home}/${location}`;
    assertEquals(
      readOnly(folder),
      `${folder} is or holds ~/${location}, where credentials are kept`,
    );
  });
}

Deno.test("layoutProblem: the credential list is the one stated, and a folder inside one is read", () => {
  assertEquals([...CREDENTIAL_LOCATIONS].sort(), [...CREDENTIALS].sort());
  assertEquals(readOnly(`${PATHS.home}/.cargo/bin`), null);
  assertEquals(readOnly(`${PATHS.home}/.sshd`), null, "a sibling sharing a prefix");
  assertEquals(readOnly(`${PATHS.home}/.deno/bin`), null);
});
