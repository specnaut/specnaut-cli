// The keychain port (#360): a minimal native secret-store surface that the
// per-platform FFI backends (macos.ts / linux.ts / windows.ts) implement, plus
// `KeychainCredentialStore`, which adapts that port to the `CredentialStore`
// interface used everywhere else.
//
// The backend methods are SYNCHRONOUS: `Deno.dlopen` and non-`nonblocking` FFI
// symbol calls are synchronous, so keeping the port sync lets selection
// (`select.ts`) and `defaultCredentialStore()` stay synchronous — no call-site
// churn from #353. `CredentialStore` stays async (the file store does real I/O);
// `KeychainCredentialStore` simply resolves the sync result.

import { type CloudCredentials, type CredentialStore, keyFor } from "../credential_store.ts";

/** All keychain items are filed under this service name; the account is the
 *  normalised Cloud API URL, so one machine holds tokens for several deployments.
 *  Intentionally kept as `specflow-cloud` through the specnaut rebrand: it is an
 *  internal at-rest identifier never shown to users, and renaming it would orphan
 *  every existing login's stored secret for no user-visible benefit. */
export const KEYCHAIN_SERVICE = "specflow-cloud";

/** Result of a single native keychain operation. `unavailable` is a value, not
 *  an exception — the normal "no reachable keyring" case must never throw. */
export type KeychainOutcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "miss" } // get only: no such item
  | { kind: "unavailable" }; // keyring not reachable this invocation

export interface KeychainBackend {
  readonly platform: "macos" | "linux" | "windows";
  /** Read the secret for (service, account). `miss` if absent. */
  get(service: string, account: string): KeychainOutcome<string>;
  /** Create or replace the secret for (service, account). */
  set(service: string, account: string, secret: string): KeychainOutcome<void>;
  /** Delete the item for (service, account); ok even if it was absent. */
  remove(service: string, account: string): KeychainOutcome<void>;
  /** Cheap, side-effect-free probe; never throws. Used by the selector. */
  reachable(): boolean;
}

/** Raised when a backend that selection deemed reachable later reports
 *  `unavailable` mid-operation (e.g. the keyring was locked between the probe
 *  and the write). Surfaced rather than silently dropping the credential. */
export class KeychainUnavailableError extends Error {
  constructor(op: string) {
    super(`OS keychain became unavailable during ${op}`);
    this.name = "KeychainUnavailableError";
  }
}

function parseCredentials(secret: string): CloudCredentials | null {
  try {
    const v = JSON.parse(secret) as Partial<CloudCredentials>;
    if (
      v && typeof v.accessToken === "string" &&
      typeof v.refreshToken === "string" &&
      typeof v.accessExpiresAt === "number"
    ) {
      return {
        accessToken: v.accessToken,
        refreshToken: v.refreshToken,
        accessExpiresAt: v.accessExpiresAt,
      };
    }
  } catch { /* fall through */ }
  return null; // corrupt item must not wedge auth (mirrors the file store)
}

/**
 * `CredentialStore` backed by a native keychain. Serialises `CloudCredentials`
 * as the JSON secret of a generic-password / credential item keyed by API URL.
 */
export class KeychainCredentialStore implements CredentialStore {
  readonly kind = "keychain" as const;

  constructor(private readonly backend: KeychainBackend) {}

  // A backend `unavailable` surfaces as a rejected promise (not a synchronous
  // throw), honouring the `CredentialStore` contract — the sync FFI result is
  // wrapped in Promise.resolve/reject.
  load(apiUrl: string): Promise<CloudCredentials | null> {
    const out = this.backend.get(KEYCHAIN_SERVICE, keyFor(apiUrl));
    if (out.kind === "unavailable") return Promise.reject(new KeychainUnavailableError("load"));
    if (out.kind === "miss") return Promise.resolve(null);
    return Promise.resolve(parseCredentials(out.value));
  }

  save(apiUrl: string, creds: CloudCredentials): Promise<void> {
    const out = this.backend.set(KEYCHAIN_SERVICE, keyFor(apiUrl), JSON.stringify(creds));
    if (out.kind === "unavailable") return Promise.reject(new KeychainUnavailableError("save"));
    return Promise.resolve();
  }

  delete(apiUrl: string): Promise<void> {
    const out = this.backend.remove(KEYCHAIN_SERVICE, keyFor(apiUrl));
    if (out.kind === "unavailable") return Promise.reject(new KeychainUnavailableError("delete"));
    return Promise.resolve();
  }
}
