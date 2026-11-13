import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { getColorEnabled, setColorEnabled } from "@std/fmt/colors";
import { fromFileUrl, join } from "@std/path";
import { run } from "../../src/main.ts";

/**
 * cli#785: an error no handler catches is printed through the same escaping as the lock messages
 * (`inertText`), never raw by Deno's own handler. A thrown message can carry a repository's path
 * or a server's text, and printed raw it is that text writing to the user's terminal.
 */

const CONTROL_TEXT = "bad \x1b]0;pwned\x07 \x9b2J ‮ path";
const SHOWN = "bad \\u001b]0;pwned\\u0007 \\u009b2J \\u202e path";
// deno-lint-ignore no-control-regex
const RAW = /[\x00-\x08\x0b-\x1f\x7f-\x9f‪-‮]/;

/** Runs the CLI's entry point on a command that rejects with `thrown`, capturing stderr. */
async function runThrowing(thrown: unknown): Promise<{ code: number; err: string }> {
  const [error, color] = [console.error, getColorEnabled()];
  let err = "";
  console.error = (...a: unknown[]) => void (err += a.join(" ") + "\n");
  setColorEnabled(false);
  try {
    return { code: await run(["any"], () => Promise.reject(thrown)), err };
  } finally {
    console.error = error;
    setColorEnabled(color);
  }
}

Deno.test("an error a command throws reaches stderr escaped, and the run exits 1", async () => {
  const { code, err } = await runThrowing(new Error(CONTROL_TEXT));
  assertEquals(code, 1);
  assertStringIncludes(err, `error: Uncaught Error: ${SHOWN}\n`);
  assert(!RAW.test(err), JSON.stringify(err));
});

Deno.test("a thrown value that is not an Error is escaped too", async () => {
  const { code, err } = await runThrowing(CONTROL_TEXT);
  assertEquals(code, 1);
  assertEquals(err, `error: Uncaught ${SHOWN}\n`);
});

/** The repository's config, so a script outside it resolves the same imports. */
const CONFIG = fromFileUrl(new URL("../../deno.json", import.meta.url));

/** A rejection nothing awaits, or a throw from a timer, in a process with the CLI's sinks. */
const FLOATING: Record<string, string> = {
  "a rejection nothing awaits": `Promise.reject(new Error(${JSON.stringify(CONTROL_TEXT)}));`,
  "a throw from a timer": `setTimeout(() => { throw new Error(${
    JSON.stringify(CONTROL_TEXT)
  }); });`,
};

for (const [what, body] of Object.entries(FLOATING)) {
  Deno.test(`${what} reaches stderr escaped, and the process exits 1`, async () => {
    const dir = await Deno.makeTempDir({ prefix: "uncaught-785-" });
    try {
      const main = new URL("../../src/main.ts", import.meta.url).href;
      const script = join(dir, "s.ts");
      await Deno.writeTextFile(
        script,
        `import { installUncaughtSinks } from "${main}";\ninstallUncaughtSinks();\n${body}\n`,
      );
      const out = await new Deno.Command(Deno.execPath(), {
        args: ["run", "--config", CONFIG, "--allow-read", "--allow-write", "--allow-env", script],
        env: { NO_COLOR: "1" },
        stderr: "piped",
      }).output();
      const err = new TextDecoder().decode(out.stderr);
      assertEquals(out.code, 1, err);
      assertStringIncludes(err, `error: Uncaught Error: ${SHOWN}\n`);
      assert(!RAW.test(err.replaceAll("\r\n", "\n")), JSON.stringify(err));
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
}
