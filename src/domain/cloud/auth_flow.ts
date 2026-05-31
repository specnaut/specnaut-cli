// Device-authorization orchestration (#353): run the browser login handshake,
// and hand out a fresh access token (refreshing transparently). All IO is
// injected so this is unit-testable without network / browser / keychain.

import type { CloudClient } from "./cloud_client.ts";
import type { CloudCredentials, CredentialStore } from "../../infrastructure/credential_store.ts";

export type AuthIo = {
  log: (msg: string) => void;
};

export type LoginDeps = {
  apiUrl: string;
  client: CloudClient;
  store: CredentialStore;
  io: AuthIo;
  openUrl: (url: string) => Promise<void>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: "denied" | "expired" | "timeout" | "invalid" };

// Refresh this many ms before the access token actually expires, so a request
// never races the boundary.
const REFRESH_SKEW_MS = 60_000;

/**
 * Run the full device-authorization login: start a request, show the user the
 * code + URL (and open the browser), poll until they approve, then persist the
 * issued credentials. Returns once credentials are stored or the flow ends.
 */
export async function login(deps: LoginDeps): Promise<LoginResult> {
  const { client, store, io, openUrl, now, sleep, apiUrl } = deps;

  const start = await client.startDevice();
  io.log("");
  io.log(`  To connect, visit:  ${start.verificationUri}`);
  io.log(`  and enter the code: ${start.userCode}`);
  io.log("");
  io.log("  Opening your browser…");
  await openUrl(start.verificationUriComplete);

  const deadline = now() + start.expiresInS * 1000;
  let intervalMs = Math.max(1, start.intervalS) * 1000;

  while (now() < deadline) {
    await sleep(intervalMs);
    const poll = await client.pollToken(start.deviceCode);
    switch (poll.status) {
      case "pending":
        continue;
      case "slow_down":
        intervalMs += 5_000; // back off per RFC 8628
        continue;
      case "denied":
        return { ok: false, reason: "denied" };
      case "expired":
        return { ok: false, reason: "expired" };
      case "invalid":
        return { ok: false, reason: "invalid" };
      case "approved": {
        const creds: CloudCredentials = {
          accessToken: poll.accessToken,
          refreshToken: poll.refreshToken,
          accessExpiresAt: now() + poll.expiresInS * 1000,
        };
        await store.save(apiUrl, creds);
        return { ok: true };
      }
    }
  }
  return { ok: false, reason: "timeout" };
}

export type TokenDeps = {
  apiUrl: string;
  client: CloudClient;
  store: CredentialStore;
  now: () => number;
};

/**
 * Return a valid access token for the deployment, refreshing transparently when
 * the stored one is near/at expiry. Returns null when there are no credentials
 * or the refresh credential is dead (caller should prompt re-login).
 */
export async function freshAccessToken(deps: TokenDeps): Promise<string | null> {
  const { client, store, now, apiUrl } = deps;
  const creds = await store.load(apiUrl);
  if (!creds) return null;

  if (creds.accessExpiresAt - now() > REFRESH_SKEW_MS) {
    return creds.accessToken;
  }

  const r = await client.refresh(creds.refreshToken);
  if (r.status !== "ok") {
    // Dead refresh token — drop the stale creds so the next login starts clean.
    await store.delete(apiUrl);
    return null;
  }
  await store.save(apiUrl, {
    accessToken: r.accessToken,
    refreshToken: r.refreshToken,
    accessExpiresAt: now() + r.expiresInS * 1000,
  });
  return r.accessToken;
}
