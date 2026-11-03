// The headless token (`SPECNAUT_CLOUD_TOKEN`, legacy `SPECFLOW_CLOUD_TOKEN`): where
// it may go, and what a refusal does. Unlike a stored credential it is bound to no
// deployment, so it goes only to the canonical endpoint or to the origin the
// environment itself names in `SPECNAUT_CLOUD_API_URL`: never to one a repository
// picked, through `api_url` or a command line it runs.
//
// One refusal policy for every caller (cli#736): say so on stderr, then use the
// user's own login for that deployment. A stored login is keyed by its URL, so it
// reaches nothing a refused token could not; no login there ends as "not
// authenticated". The token itself is sent nowhere either way.

import { DEFAULT_CLOUD_API_URL, normalizeApiUrl } from "./cloud_config.ts";

/** A headless token handed over for a deployment, or the origin it was refused for. */
export type HeadlessToken = { token: string } | { refused: string } | null;

/** The headless token for `apiUrl`, or `null` when the environment sets none. */
export function headlessToken(
  apiUrl: string,
  env: (key: string) => string | undefined,
): HeadlessToken {
  const token = (env("SPECNAUT_CLOUD_TOKEN") ?? env("SPECFLOW_CLOUD_TOKEN"))?.trim();
  if (!token) return null;
  const origin = originOf(apiUrl);
  const allowed = [DEFAULT_CLOUD_API_URL, env("SPECNAUT_CLOUD_API_URL") ?? ""].map(originOf);
  return origin && allowed.includes(origin) ? { token } : { refused: origin ?? apiUrl };
}

/** Why a headless token was not sent, for the caller to print. */
export function headlessRefusal(origin: string): string {
  return `SPECNAUT_CLOUD_TOKEN is not sent to ${origin}: a headless token goes only to ` +
    `${DEFAULT_CLOUD_API_URL}, or to the origin SPECNAUT_CLOUD_API_URL names.`;
}

function originOf(url: string): string | null {
  const u = normalizeApiUrl(url);
  return u ? new URL(u).origin : null;
}
