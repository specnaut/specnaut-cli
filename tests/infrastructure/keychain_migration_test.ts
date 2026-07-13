import { assertEquals } from "@std/assert";
import {
  KEYCHAIN_SERVICE,
  type KeychainBackend,
  KeychainCredentialStore,
  type KeychainOutcome,
  LEGACY_KEYCHAIN_SERVICE,
} from "../../src/infrastructure/keychain/keychain_backend.ts";
import { keyFor } from "../../src/infrastructure/credential_store.ts";

const CREDS = { accessToken: "a", refreshToken: "r", accessExpiresAt: 123 };
const CREDS_JSON = JSON.stringify(CREDS);
const API = "https://api.specnaut.com";

/** In-memory keychain keyed by `service\x00account`, recording removes. */
function memBackend(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  const removed: string[] = [];
  const k = (s: string, a: string) => `${s}\x00${a}`;
  const backend: KeychainBackend = {
    platform: "macos",
    get(service, account): KeychainOutcome<string> {
      const v = store.get(k(service, account));
      return v === undefined ? { kind: "miss" } : { kind: "ok", value: v };
    },
    set(service, account, secret): KeychainOutcome<void> {
      store.set(k(service, account), secret);
      return { kind: "ok", value: undefined };
    },
    remove(service, account): KeychainOutcome<void> {
      removed.push(k(service, account));
      store.delete(k(service, account));
      return { kind: "ok", value: undefined };
    },
    reachable: () => true,
  };
  return { backend, store, removed, k };
}

Deno.test("load migrates a legacy specflow-cloud item forward to specnaut-cloud", async () => {
  const acct = keyFor(API);
  const { backend, store, removed, k } = memBackend({
    [`${LEGACY_KEYCHAIN_SERVICE}\x00${acct}`]: CREDS_JSON,
  });
  const store2 = new KeychainCredentialStore(backend);

  const loaded = await store2.load(API);
  assertEquals(loaded, CREDS);
  // Copied forward under the new brand …
  assertEquals(store.get(k(KEYCHAIN_SERVICE, acct)), CREDS_JSON);
  // … and the legacy item was dropped.
  assertEquals(removed.includes(k(LEGACY_KEYCHAIN_SERVICE, acct)), true);
  assertEquals(store.has(k(LEGACY_KEYCHAIN_SERVICE, acct)), false);
});

Deno.test("load prefers the current-brand item and never touches legacy when present", async () => {
  const acct = keyFor(API);
  const { backend, removed, k } = memBackend({
    [`${KEYCHAIN_SERVICE}\x00${acct}`]: CREDS_JSON,
  });
  const loaded = await new KeychainCredentialStore(backend).load(API);
  assertEquals(loaded, CREDS);
  // No migration read/remove of the legacy service happened.
  assertEquals(removed.includes(k(LEGACY_KEYCHAIN_SERVICE, acct)), false);
});

Deno.test("load returns null when neither brand has an item", async () => {
  const { backend } = memBackend();
  assertEquals(await new KeychainCredentialStore(backend).load(API), null);
});

Deno.test("delete removes both the current and the legacy item", async () => {
  const acct = keyFor(API);
  const { backend, removed, k } = memBackend({
    [`${KEYCHAIN_SERVICE}\x00${acct}`]: CREDS_JSON,
    [`${LEGACY_KEYCHAIN_SERVICE}\x00${acct}`]: CREDS_JSON,
  });
  await new KeychainCredentialStore(backend).delete(API);
  assertEquals(removed.includes(k(KEYCHAIN_SERVICE, acct)), true);
  assertEquals(removed.includes(k(LEGACY_KEYCHAIN_SERVICE, acct)), true);
});
