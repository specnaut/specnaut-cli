import { assertEquals } from "@std/assert";
import { ok, prober } from "./sandbox_probe_fixture.ts";

/** Docker as the probe finds it: a daemon that answers with a version. */

Deno.test("probe: docker counts only when its daemon answers with a version", async () => {
  assertEquals((await prober("linux", { docker: ok("27.1.0\n") }).prober.probe()).docker, true);
  assertEquals((await prober("linux", { docker: ok("\n") }).prober.probe()).docker, false);
  const down = { code: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" };
  assertEquals((await prober("linux", { docker: down }).prober.probe()).docker, false);
});
