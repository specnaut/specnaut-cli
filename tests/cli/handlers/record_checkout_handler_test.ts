import { assertEquals, assertStringIncludes } from "@std/assert";
import { runRecordCheckout } from "../../../src/cli/handlers/record_checkout_handler.ts";

/** Old records that could not be removed are reported, and the record still stands. */

const HEAD = "c".repeat(40);

Deno.test("a prune failure is reported on stderr, and the exit is still 0", async () => {
  const said: string[] = [];
  const code = await runRecordCheckout({
    cwd: "/project",
    input: () => Promise.resolve(JSON.stringify({ session_id: "a-session", source: "startup" })),
    err: (s) => said.push(s),
    open: () =>
      Promise.resolve({
        git: { commitOf: () => Promise.resolve(HEAD) },
        reflog: {
          headReflog: () =>
            Promise.resolve(new TextEncoder().encode(`${HEAD} ${HEAD} A <a@b> 1 +0000\tx\n`)),
        },
        checkout: { walk: () => Promise.resolve({ kind: "walked", entries: [] }) },
        records: {
          write: () =>
            Promise.resolve({ kind: "taken", path: "/r.json", pruneFailure: "remove refused" }),
          find: () => Promise.reject(new Error("not reached")),
        },
      }),
  });
  assertEquals(code, 0);
  assertEquals(said.length, 1);
  assertStringIncludes(said[0], "old session records could not all be removed: remove refused");
});
