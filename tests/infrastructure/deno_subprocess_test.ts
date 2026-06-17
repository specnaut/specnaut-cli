import { assertEquals } from "@std/assert";
import { DenoSubprocessRunner } from "../../src/infrastructure/deno_subprocess.ts";

Deno.test("DenoSubprocessRunner returns code 127 (not throw) when binary is missing", async () => {
  const runner = new DenoSubprocessRunner();
  const result = await runner.run("specnaut-this-binary-does-not-exist-xyz", ["--version"]);
  assertEquals(result.code, 127);
  assertEquals(result.stdout, "");
  assertEquals(result.stderr.includes("command not found"), true);
});

Deno.test("DenoSubprocessRunner returns real exit code when binary exists", async () => {
  // `true` is POSIX-standard; on Windows CI we'd skip — but specnaut is Unix-first.
  const runner = new DenoSubprocessRunner();
  const result = await runner.run("true", []);
  assertEquals(result.code, 0);
});
