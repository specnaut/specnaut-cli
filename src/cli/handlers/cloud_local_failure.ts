// What `spec` and `gate` explain in one line and exit 1 on: a failure found on this
// machine, before Cloud said anything, whose message is the whole explanation.

import { CloudConfigUnreadable } from "../../infrastructure/fs_backlog_config_store.ts";
import { InvalidApiUrl } from "../../domain/cloud/cloud_config.ts";

/** The link file cannot be read, or its api_url is not a plain http(s) URL. */
export function isLocalFailure(e: unknown): e is Error {
  return e instanceof CloudConfigUnreadable || e instanceof InvalidApiUrl;
}
