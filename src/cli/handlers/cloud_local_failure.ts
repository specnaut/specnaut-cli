// What `spec` and `gate` explain in one line and exit 1 on: a failure found on this
// machine, before any request, whose message is the whole explanation.

import { CloudConfigUnreadable } from "../../infrastructure/fs_backlog_config_store.ts";
import { InvalidApiUrl } from "../../domain/cloud/cloud_config.ts";
import { CredentialRefused } from "../../domain/cloud/credential_check.ts";

/** The link file cannot be read, its api_url is not plain, or the text holds a credential. */
export function isLocalFailure(e: unknown): e is Error {
  return e instanceof CloudConfigUnreadable || e instanceof InvalidApiUrl ||
    e instanceof CredentialRefused;
}
