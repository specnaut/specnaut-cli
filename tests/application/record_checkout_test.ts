import { assertEquals } from "@std/assert";
import {
  NO_FIRST_RECORD,
  NO_REFLOG,
  recordCheckout,
  type RecordCheckoutDeps,
} from "../../src/application/record_checkout.ts";

/**
 * Only a session's start takes its record, and only of what can be marked; a resume or a fork
 * finds the session's first record, or is refused.
 */

const ENTRY = `${"c".repeat(40)} ${"c".repeat(40)} A <a@b> 1 +0000\tx\n`;

function deps(reflog: string | null, found: string | null = null) {
  const written: string[] = [];
  const d: RecordCheckoutDeps = {
    git: { commitOf: () => Promise.resolve("c".repeat(40)) },
    reflog: { headReflog: () => Promise.resolve(reflog === null ? null : enc(reflog)) },
    checkout: { walk: () => Promise.resolve({ kind: "walked", entries: [] }) },
    records: {
      write: (id) => {
        written.push(id);
        return Promise.resolve({ kind: "taken", path: id });
      },
      find: () => Promise.resolve(found === null ? null : { kind: "existing", path: found }),
    },
  };
  return { d, written };
}

const enc = (s: string) => new TextEncoder().encode(s);

Deno.test("a HEAD with no reflog, or one holding no entry, takes no record", async () => {
  for (const reflog of [null, "", "not an entry\n"]) {
    const { d, written } = deps(reflog);
    const outcome = await recordCheckout(d, { sessionId: "a-session", source: "startup" });
    assertEquals(outcome, { kind: "refused", why: NO_REFLOG }, String(reflog));
    assertEquals(written, [], String(reflog));
  }
});

Deno.test("a resume or a fork finds the session's first record, never takes one", async () => {
  for (const source of ["resume", "fork"]) {
    const none = deps(ENTRY);
    const refused = await recordCheckout(none.d, { sessionId: "a-session", source });
    assertEquals(refused, { kind: "refused", why: NO_FIRST_RECORD }, source);
    assertEquals(none.written, [], source);
    const found = deps(ENTRY, "/first.json");
    const kept = await recordCheckout(found.d, { sessionId: "a-session", source });
    assertEquals(kept, { kind: "existing", path: "/first.json" }, source);
    assertEquals(found.written, [], source);
  }
});
