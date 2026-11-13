// The trust gate `specnaut cloud login` passes before it authenticates: a URL a
// project config chose, never logged into, is confirmed by the user first (#400).

import { red, yellow } from "@std/fmt/colors";
import type { CredentialStore } from "../../domain/cloud/credentials.ts";
import type { ApiUrlSource, ResolvedApiUrl } from "./cloud_api_url.ts";

/** Whether `login` must confirm before authenticating: only when the URL came
 *  from a project config file AND the user has never authenticated against it.
 *  That is the precise phishing window — a committed `backlog-config.yml`
 *  redirecting login at an attacker host — while an explicit `--api-url`, the
 *  CLI-shipped default endpoint, or re-login to a known deployment stay
 *  friction-free (#400). */
export function loginNeedsTrustConfirm(
  source: ApiUrlSource,
  hasExistingCreds: boolean,
): boolean {
  return source === "config" && !hasExistingCreds;
}

/**
 * First-ever auth against a URL a project config chose is the phishing window —
 * require an explicit confirmation there (and only there). An --api-url flag, a
 * typed URL, or re-login to a known deployment proceed unprompted.
 *
 * Only a `config` source can EVER require the gate, so read credentials only
 * then. For the default endpoint / an explicit flag the answer is always "no
 * confirm" — reading here would just pop a keychain prompt (and, mid-rebrand,
 * a legacy-item migration read) to compute a value we'd discard. Login writes
 * fresh credentials regardless, so it never needs the existing ones.
 */
export async function trustedTarget(
  resolved: ResolvedApiUrl,
  store: CredentialStore,
): Promise<boolean> {
  const existing = resolved.source === "config" ? await store.load(resolved.url) : null;
  if (!loginNeedsTrustConfirm(resolved.source, existing !== null)) return true;
  console.log(yellow("  ⚠ this URL comes from the project config, not from you, and you have"));
  console.log(yellow("    never logged in here before."));
  const answer = (prompt("  Authenticate against this server? [y/N]") ?? "").trim().toLowerCase();
  if (answer === "y" || answer === "yes") return true;
  console.error(red("aborted — login cancelled."));
  return false;
}
