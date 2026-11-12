import { assertEquals } from "@std/assert";
import { recordCheckout } from "../../src/application/record_checkout.ts";

/** The record is taken only of what can be marked: a HEAD reflog that lists nothing refuses it. */

Deno.test("a HEAD whose reflog lists nothing takes no record", async () => {
  const written: string[] = [];
  const outcome = await recordCheckout({
    git: { commitOf: () => Promise.resolve("c".repeat(40)), headReflog: () => Promise.resolve([]) },
    checkout: { walk: () => Promise.resolve({ kind: "walked", entries: [] }) },
    records: {
      write: (id) => {
        written.push(id);
        return Promise.resolve({ kind: "taken", path: id });
      },
    },
  }, { sessionId: "a-session", source: "startup" });
  assertEquals(outcome, { kind: "refused", why: "HEAD's reflog cannot be read" });
  assertEquals(written, []);
});
