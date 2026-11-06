import { assertEquals } from "@std/assert";
import {
  runVerifyScripts,
  type VerifyScriptsDeps,
} from "../../src/cli/handlers/verify_scripts_handler.ts";

/** Whatever fails, the handler answers with an exit and a last line that is the untrusted verdict. */

function deps(over: Partial<VerifyScriptsDeps>) {
  const out: string[] = [];
  const err: string[] = [];
  const d: VerifyScriptsDeps = {
    cwd: Deno.cwd(),
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    open: () => Promise.reject(new Error("git could not start")),
    writeNames: () => Promise.resolve("/tmp/names"),
    ...over,
  };
  return { d, out, err };
}

Deno.test("a failure opening the repository is exit 3 with the untrusted verdict last", async () => {
  const { d, out } = deps({});
  assertEquals(await runVerifyScripts(d), 3);
  assertEquals(out.at(-1), "VERDICT scripts untrusted");
});

Deno.test("a folder that cannot even be looked at is exit 3, not an escaped throw", async () => {
  const { d, out } = deps({ cwd: "bad\0folder" });
  assertEquals(await runVerifyScripts(d), 3);
  assertEquals(out.at(-1), "VERDICT scripts untrusted");
});
