import { assertEquals, assertThrows } from "@std/assert";
import { parseOptions, probe } from "../../scripts/keychain-probe.ts";
import type { KeychainBackend } from "../../src/infrastructure/keychain/keychain_backend.ts";

/**
 * cli#662 — the TypeScript keychain probe touches only the service it is given,
 * refuses the CLI's own, and leaves nothing behind.
 */

function memBackend(
  items = new Map<string, string>(),
): KeychainBackend & { items: Map<string, string> } {
  const k = (s: string, a: string) => `${s}\u0000${a}`;
  return {
    platform: "linux",
    items,
    get: (s, a) =>
      items.has(k(s, a)) ? { kind: "ok", value: items.get(k(s, a))! } : { kind: "miss" },
    set: (s, a, v) => (items.set(k(s, a), v), { kind: "ok", value: undefined }),
    remove: (s, a) => (items.delete(k(s, a)), { kind: "ok", value: undefined }),
    reachable: () => true,
  };
}

const CANARY = "c4n4ry-0123456789abcdef";

Deno.test("the probe refuses the real service names and requires one", () => {
  for (const s of ["specnaut-cloud", "Specflow-Cloud"]) {
    assertEquals(typeof parseOptions(["write", "--service", s]), "string", `${s} accepted`);
  }
  assertEquals(typeof parseOptions(["write"]), "string", "no --service, yet accepted");
  assertEquals(parseOptions(["read", "--service", "specnaut-keychain-probe"]), {
    mode: "read",
    service: "specnaut-keychain-probe",
    account: "probe",
  });
});

Deno.test("roundtrip matches and removes its item", () => {
  const b = memBackend();
  const code = probe(
    b,
    { mode: "roundtrip", service: "specnaut-keychain-probe", account: "p" },
    CANARY,
  );
  assertEquals(code, 0);
  assertEquals(b.items.size, 0, "roundtrip left an item behind");
});

Deno.test("roundtrip removes its item even when the read throws", () => {
  const b = memBackend();
  const throwing = {
    ...b,
    get: () => {
      throw new Error("boom");
    },
  };
  assertThrows(() =>
    probe(throwing, { mode: "roundtrip", service: "specnaut-keychain-probe", account: "p" }, CANARY)
  );
  assertEquals(b.items.size, 0);
});
