import { killNamed } from "./sandbox_live_fixture.ts";

/** The live tests' own helpers, where a mistake would fail a test that found nothing wrong. */

Deno.test({
  name: "killNamed: a process that ended before its kill is already stopped",
  ignore: Deno.build.os === "windows",
  fn: () => {
    // `ps` lists itself, and has ended by the time its list is read: its kill finds no process.
    killNamed("/bin/ps -axo pid=,command=");
  },
});
