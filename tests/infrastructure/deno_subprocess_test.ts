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

Deno.test({
  name: "DenoSubprocessRunner: with wholeEnv, an env given is the child's whole environment",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const name = "SPECNAUT_SUBPROCESS_PARENT_ONLY";
    Deno.env.set(name, "from-the-parent");
    try {
      const script = `printf "%s|%s" "\${${name}:-unset}" "$GIVEN"`;
      const run = (r: DenoSubprocessRunner) =>
        r.run("/bin/sh", ["-c", script], { env: { GIVEN: "g" } });
      assertEquals((await run(new DenoSubprocessRunner())).stdout, "from-the-parent|g");
      assertEquals((await run(new DenoSubprocessRunner({ wholeEnv: true }))).stdout, "unset|g");
      // Without an env given, the child keeps ours whatever the option says.
      const kept = await new DenoSubprocessRunner({ wholeEnv: true }).run("/bin/sh", [
        "-c",
        script,
      ]);
      assertEquals(kept.stdout, "from-the-parent|");
    } finally {
      Deno.env.delete(name);
    }
  },
});
