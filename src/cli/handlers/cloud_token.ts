// The `specnaut cloud` commands' bearer token, with the reason said when there is
// none. A logged-out user is told to log in; an unavailable Cloud is not, because
// their login is fine and is kept.

import { dim, red } from "@std/fmt/colors";
import { accessToken } from "../../domain/cloud/auth_flow.ts";
import { CloudApiError, type CloudClient, isUnavailable } from "../../domain/cloud/cloud_client.ts";
import type { CredentialStore } from "../../domain/cloud/credentials.ts";

/** A token for `apiUrl`, or null once the reason has been printed. Never prints the token. */
export async function requireCloudToken(
  apiUrl: string,
  client: CloudClient,
  store: CredentialStore,
): Promise<string | null> {
  try {
    const token = await accessToken({ apiUrl, client, store, now: () => Date.now() });
    if (token) return token;
    console.error(red("error: not authenticated with Specnaut Cloud."));
    console.error(dim("  run `specnaut cloud login` (or set SPECNAUT_CLOUD_TOKEN)."));
  } catch (e) {
    if (!(e instanceof CloudApiError)) throw e;
    const why = isUnavailable(e) ? "cannot be reached" : "answered unexpectedly";
    console.error(red(`error: Specnaut Cloud ${why} — your login is kept; retry.`));
  }
  return null;
}
