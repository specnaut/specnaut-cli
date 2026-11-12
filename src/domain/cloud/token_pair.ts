// The token pair an approving auth answer carries (`/auth/token`, `/auth/refresh`):
// both tokens present and non-empty, and an expiry no server can stretch.

import { clamp } from "./cloud_wire.ts";

/** A year: far beyond any real access token, and far from an overflowing expiry. */
const MAX_TOKEN_TTL_S = 31_536_000;

/** A token pair from an approving answer, or null when it does not carry a real one. */
export function tokenPair(json: Record<string, unknown>) {
  const { access_token: accessToken, refresh_token: refreshToken } = json;
  if (typeof accessToken !== "string" || !accessToken) return null;
  if (typeof refreshToken !== "string" || !refreshToken) return null;
  // Clamped like startDevice's timing: a server cannot grant a token "forever".
  return {
    accessToken,
    refreshToken,
    expiresInS: clamp(Number(json.expires_in ?? 0), 0, MAX_TOKEN_TTL_S),
  };
}
