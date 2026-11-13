import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { runSandbox, type SandboxDeps } from "../../src/cli/handlers/sandbox_handler.ts";
import { openCappedLog } from "../../src/infrastructure/capped_log.ts";
import { realLogPath } from "../../src/infrastructure/fs_review_lock.ts";
import type { SandboxIntent } from "../../src/cli/intent.ts";
import { EXEC, MAC, ran } from "./sandbox_handler_fixture.ts";

/**
 * `sandbox exec --log`: the path the review lock judges is the path the run opens, so a folder
 * link changed between the two moves nothing.
 */

const POSIX = Deno.build.os !== "windows";

/** The fixture's run, logging to `log`. */
const logged = (log: string) => ({ ...EXEC, log }) as SandboxIntent;

/** Deps whose lock check repoints `link` at `elsewhere` once it judged, then lets the run go. */
function relinkingDeps(link: string, elsewhere: string, judged: (string | null)[]): SandboxDeps {
  return {
    out: () => {},
    err: () => {},
    probe: () => Promise.resolve(MAC),
    realLog: realLogPath,
    lockRefusal: async (request) => {
      judged.push(request.log);
      await Deno.remove(link);
      await Deno.symlink(elsewhere, link);
      return null;
    },
    exec: async (request) => {
      const log = await openCappedLog(request.log!);
      await log.close();
      return ran("seatbelt");
    },
  };
}

Deno.test({
  name: "sandbox exec: the --log is opened where the lock judged it, whatever a link says since",
  ignore: !POSIX,
  fn: async () => {
    const root = await Deno.realPath(await Deno.makeTempDir({ prefix: "sandbox-log-" }));
    try {
      const [logs, elsewhere, link] = ["logs", "elsewhere", "link"].map((n) => join(root, n));
      await Deno.mkdir(logs);
      await Deno.mkdir(elsewhere);
      await Deno.symlink(logs, link);
      const judged: (string | null)[] = [];
      assertEquals(
        await runSandbox(logged(join(link, "1.log")), relinkingDeps(link, elsewhere, judged)),
        0,
      );
      assertEquals(judged, [join(logs, "1.log")], "judged by where it resolved");
      assertEquals((await Deno.lstat(join(logs, "1.log"))).isFile, true, "made there");
      await assertRejects(() => Deno.lstat(join(elsewhere, "1.log")), Deno.errors.NotFound);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});

Deno.test("sandbox exec: a --log whose folder does not resolve is 125, nothing judged or run", async () => {
  let reached = false;
  const err: string[] = [];
  const d: SandboxDeps = {
    out: () => {},
    err: (s) => err.push(s),
    probe: () => Promise.resolve(MAC),
    realLog: () => Promise.resolve(null),
    lockRefusal: () => Promise.resolve(void (reached = true)).then(() => null),
    exec: () => Promise.resolve(void (reached = true)).then(() => ran("seatbelt")),
  };
  assertEquals(await runSandbox(logged("/nowhere/1.log"), d), 125);
  assertEquals(reached, false);
  assertEquals(err.join("\n").includes("/nowhere/1.log"), true);
});
