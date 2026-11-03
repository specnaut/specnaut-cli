// The `specnaut cloud` commands' bearer token, with the reason said when there is
// none. A logged-out user is told to log in; an unavailable Cloud is not, because
// their login is fine and is kept.

import { dim, red } from "@std/fmt/colors";
import { accessToken } from "../../domain/cloud/auth_flow.ts";
import {
  CloudApiError,
  type CloudClient,
  isRedirected,
  isUnavailable,
} from "../../domain/cloud/cloud_client.ts";
import { hasControl, REDIRECT_REFUSED } from "../../domain/cloud/cloud_wire.ts";
import type { CredentialStore } from "../../domain/cloud/credentials.ts";

/** What went wrong with a Cloud request, in the CLI's own words (§ I). */
export function cloudFailure(e: CloudApiError): string {
  if (isRedirected(e)) return REDIRECT_REFUSED;
  return `Specnaut Cloud ${
    isUnavailable(e) ? "cannot be reached" : "answered unexpectedly"
  }; retry`;
}

/** Print a token for a script to read, once it is well formed. The exit code. */
export function printToken(token: string, fix = "run `specnaut cloud login`"): number {
  if (hasControl(token)) {
    console.error(red(`error: the token is not usable; ${fix}.`));
    return 1;
  }
  console.log(token);
  return 0;
}

/**
 * A token for `apiUrl`, or null once the reason has been printed. Never prints the
 * token. `loginHint` is what a logged-out user is told to do: only `cloud token`
 * reads SPECNAUT_CLOUD_TOKEN, so only it may offer that.
 */
export async function requireCloudToken(
  apiUrl: string,
  client: CloudClient,
  store: CredentialStore,
  loginHint = "run `specnaut cloud login`.",
): Promise<string | null> {
  try {
    const token = await accessToken({ apiUrl, client, store, now: () => Date.now() });
    if (token) return token;
    console.error(red("error: not authenticated with Specnaut Cloud."));
    console.error(dim(`  ${loginHint}`));
  } catch (e) {
    if (!(e instanceof CloudApiError)) throw e;
    console.error(red(`error: ${cloudFailure(e)}. Your login is kept.`));
  }
  return null;
}
