import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { exists, killNamed } from "./sandbox_live_fixture.ts";
import { POSIX } from "./sandbox_runner_fixture.ts";

/**
 * A container run stopped by a signal removes its container on the way out, and with it what was
 * written for the run where nothing still reads it: docker's folder goes, as its client read the
 * profile when the run started. Podman's is kept, as the watchdog's removal, which outlives the
 * CLI, still reads the containers.conf in it.
 */

/** Seconds no other test sleeps, so the fake engine's `run` can be found and ended. */
const MARKER = "sleep 30.241";

/** A fake engine: it records the profile `run` is handed in `<base>/handed`, then hangs. */
function fakeEngine(base: string): string {
  const handed = join(base, "handed");
  return [
    "#!/bin/sh",
    'for a in "$@"; do case "$a" in seccomp=*)',
    `  printf '%s' "$a" > "${handed}.tmp" && mv "${handed}.tmp" "${handed}";;`,
    "esac; done",
    'if [ "$1" = --default-mounts-file ]; then shift 2; fi',
    `case "$1" in run) exec ${MARKER} ;; esac`,
    "",
  ].join("\n");
}

/** Waits until `path` exists, failing past `ms`. */
async function appeared(path: string, ms = 15_000): Promise<void> {
  for (const until = Date.now() + ms; !exists(path);) {
    if (Date.now() > until) throw new Error(`${path} never appeared`);
    await new Promise((done) => setTimeout(done, 50));
  }
}

const CHILD = fromFileUrl(new URL("./sandbox_interrupted_runner.ts", import.meta.url));
const FLAGS = ["--allow-read", "--allow-write", "--allow-run", "--allow-env"];

for (const [engine, kept] of [["podman", true], ["docker", false]] as const) {
  Deno.test({
    name: `engine interrupt: a ${engine} run stopped by SIGTERM ${kept ? "keeps" : "removes"} ` +
      "its folder",
    ignore: !POSIX,
    fn: async () => {
      const base = await Deno.makeTempDir({ prefix: "specnaut-interrupt-" });
      const fake = join(base, "engine");
      await Deno.writeTextFile(fake, fakeEngine(base), { mode: 0o755 });
      const child = new Deno.Command(Deno.execPath(), {
        args: ["run", ...FLAGS, CHILD, engine, fake],
        stdout: "null",
        stderr: "null",
      }).spawn();
      let folder = "";
      try {
        await appeared(join(base, "handed"));
        folder = dirname(Deno.readTextFileSync(join(base, "handed")).slice("seccomp=".length));
        child.kill("SIGTERM");
        assertEquals((await child.status).code, 143);
        assertEquals(exists(folder), kept);
      } finally {
        if (folder !== "" && exists(folder)) await Deno.remove(folder, { recursive: true });
        await Deno.remove(base, { recursive: true });
        killNamed(MARKER);
      }
    },
  });
}
