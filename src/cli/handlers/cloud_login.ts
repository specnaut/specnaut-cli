// `specnaut cloud login`'s device handshake, with the reason said when it ends
// without a login. A dropped connection or a refused redirect is a message, not a
// stack.

import { red } from "@std/fmt/colors";
import { login, type LoginDeps } from "../../domain/cloud/auth_flow.ts";
import { CloudApiError } from "../../domain/cloud/cloud_client.ts";
import { cloudFailure } from "./cloud_token.ts";

const RETRY = "Run `specnaut cloud login` to try again.";

/** True once credentials are stored; otherwise the reason has been printed. */
export async function deviceLogin(deps: LoginDeps): Promise<boolean> {
  try {
    const result = await login(deps);
    if (result.ok) return true;
    const reason = {
      denied: "authorization was denied.",
      expired: "the code expired before approval.",
      timeout: "timed out waiting for approval.",
      invalid: "the authorization request was invalid.",
    }[result.reason];
    console.error(red(`error: ${reason} ${RETRY}`));
  } catch (e) {
    if (!(e instanceof CloudApiError)) throw e;
    console.error(red(`error: ${cloudFailure(e)}. ${RETRY}`));
  }
  return false;
}
