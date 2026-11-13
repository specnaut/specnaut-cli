import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

/**
 * The exit traps run newest first, each once, whether the process ends or is stopped by a signal:
 * what was set up last is torn down first. A run's volume is detached before the host removes the
 * scratch folder it is mounted on, and a run's processes are stopped before either.
 */

const PROBE = fromFileUrl(new URL("./exit_trap_probe.ts", import.meta.url));
const POSIX = Deno.build.os !== "windows";

function probe(how: string): Deno.ChildProcess {
  return new Deno.Command(Deno.execPath(), {
    args: ["run", PROBE, how],
    stdin: "null",
    stdout: "piped",
    stderr: "null",
  }).spawn();
}

Deno.test("exit traps: a process that ends runs them newest first, a disarmed one never", async () => {
  const { code, stdout } = await probe("exit").output();
  assertEquals(code, 0);
  assertEquals(new TextDecoder().decode(stdout), "armed\nthird\nfirst\n");
});

Deno.test({
  name: "exit traps: a process stopped by SIGTERM runs them newest first, each once, then 143",
  ignore: !POSIX,
  fn: async () => {
    const child = probe("signal");
    const reader = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
    let out = "";
    while (!out.includes("armed\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      out += value;
    }
    child.kill("SIGTERM");
    for (let read = await reader.read(); !read.done; read = await reader.read()) out += read.value;
    assertEquals((await child.status).code, 143);
    assertEquals(out, "armed\nthird\nfirst\n");
  },
});
