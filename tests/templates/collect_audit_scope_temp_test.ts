// Each read collect-audit-scope.sh makes keeps git's error output in a temporary file, to tell a
// refusal from an empty answer. When that file cannot be made, the script stops: a read whose
// error output went nowhere would answer an empty scope, and an audit of nothing passes.

import { assertEquals, assertStringIncludes } from "@std/assert";
import { DELIMITER, join } from "@std/path";
import { fixtureRepo, scope } from "./collect_audit_scope_fixture.ts";

/** A PATH whose first folder holds a `mktemp` that always fails. */
async function failingMktemp(): Promise<Record<string, string>> {
  const dir = await Deno.makeTempDir({ prefix: "scope-no-mktemp-" });
  await Deno.writeTextFile(join(dir, "mktemp"), "#!/bin/sh\nexit 1\n");
  await Deno.chmod(join(dir, "mktemp"), 0o755);
  return { PATH: `${dir}${DELIMITER}${Deno.env.get("PATH") ?? ""}` };
}

Deno.test({
  name: "collect-audit-scope stops when it cannot make a temporary file",
  // Git for Windows' bash puts its own folders first on the PATH, ahead of the stub.
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const dir = await fixtureRepo();
    const r = await scope(dir, ["--path", "src"], await failingMktemp());
    assertEquals(r.code, 2, r.stdout);
    assertStringIncludes(r.stderr, "error: cannot create a temporary file");
    assertEquals(r.stdout, "");
  },
});
