// `specnaut cloud <login|token|logout|orgs|board>` (#353, #398) — the CLI side
// of the Specnaut Cloud backlog backend's interactive auth + read commands.
//
//   login   device-authorization browser flow → stores credentials securely,
//           then binds the project to a Cloud project (select or create) and
//           writes .specnaut/backlog-config.yml. Also reachable as the
//           top-level `specnaut login` alias.
//   token   prints a fresh access token to stdout (refreshing transparently);
//           used by the bundled cloud/*.sh scripts. SPECNAUT_CLOUD_TOKEN (or legacy
//           SPECFLOW_CLOUD_TOKEN) is the headless / CI escape hatch.
//   logout  removes the stored credentials for the deployment.
//   orgs    lists the account's organizations (active one flagged).
//   board   shows the linked project's board, tasks grouped by column.

import { bold, dim, green, red, yellow } from "@std/fmt/colors";
import { CloudClient } from "../../domain/cloud/cloud_client.ts";
import { headlessRefusal, headlessToken } from "../../domain/cloud/headless_token.ts";
import type { CredentialStore } from "../../domain/cloud/credentials.ts";
import { openInBrowser } from "../../infrastructure/browser_opener.ts";
import { defaultCredentialStore } from "../../infrastructure/credential_store.ts";
import { resolveApiUrl, type ResolvedApiUrl, urlSourceLabel } from "./cloud_api_url.ts";
import { deviceLogin } from "./cloud_login.ts";
import { trustedTarget } from "./cloud_login_trust.ts";
import { bindingClient, bindProject } from "./cloud_project_binding.ts";
import { runBoard, runOrgs } from "./cloud_read_commands.ts";
import { printToken, requireCloudToken } from "./cloud_token.ts";

export type CloudIntent = {
  kind: "cloud";
  sub: "login" | "token" | "logout" | "orgs" | "board";
  apiUrl: string | null;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runCloud(intent: CloudIntent): Promise<number> {
  switch (intent.sub) {
    case "login":
      return await runLogin(intent);
    case "token":
      return await runToken(intent);
    case "logout":
      return await runLogout(intent);
    case "orgs":
      return await runOrgs(intent.apiUrl);
    case "board":
      return await runBoard(intent.apiUrl);
  }
}

/** `login` is a browser handshake: say what serves a machine with no terminal. */
function refuseNoTerminal(): number {
  console.error(red("error: `specnaut cloud login` needs an interactive terminal."));
  console.error(
    dim(
      "  For CI / headless use, set SPECNAUT_CLOUD_TOKEN: `cloud token`, `spec` and `gate` read it; " +
        "`cloud orgs` and `cloud board` need this login.",
    ),
  );
  return 2;
}

async function runLogin(intent: CloudIntent): Promise<number> {
  if (!Deno.stdin.isTerminal()) return refuseNoTerminal();
  const resolved = await resolveApiUrl(intent.apiUrl);
  if (!resolved) return 2;
  discloseTarget(resolved);
  const { client, store } = bindingClient(resolved.url, defaultCredentialStore());
  if (!await trustedTarget(resolved, store)) return 1;
  const loggedIn = await deviceLogin({
    apiUrl: resolved.url,
    client,
    store,
    io: { log: (m) => console.log(m) },
    openUrl: openInBrowser,
    now: () => Date.now(),
    sleep,
  });
  if (!loggedIn) return 1;
  reportStored(store);
  return await bindProject(resolved.url, client, store);
}

/**
 * Disclose the target server + where the URL came from BEFORE opening the
 * browser, so a config-supplied (potentially attacker-controlled) api_url is
 * visible and interceptable rather than silently authenticated against (#400).
 */
function discloseTarget(resolved: ResolvedApiUrl): void {
  console.log("");
  console.log(`  Connecting to:  ${bold(resolved.url)}`);
  console.log(dim(`  Source:         ${urlSourceLabel(resolved.source)}`));
}

/** The login is stored: say where. */
function reportStored(store: CredentialStore): void {
  console.log(green("✓ authenticated with Specnaut Cloud"));
  console.log(
    dim(
      store.kind === "keychain"
        ? "  credentials stored in the OS keychain"
        : "  credentials stored in ~/.specnaut/credentials.json (0600 — no OS keychain available)",
    ),
  );
}

async function runToken(intent: CloudIntent): Promise<number> {
  const resolved = await resolveApiUrl(intent.apiUrl);
  if (!resolved) return 1;
  const apiUrl = resolved.url;
  // Headless / CI: the environment's token wins, for a deployment it may go to only.
  const headless = headlessToken(apiUrl, (k) => Deno.env.get(k));
  if (headless && "token" in headless) {
    return printToken(headless.token, "fix SPECNAUT_CLOUD_TOKEN");
  }
  // Refused: the policy every session follows (headless_token.ts), so a script and
  // the session beside it never disagree about the same project.
  if (headless) console.error(yellow(`warning: ${headlessRefusal(headless.refused)}`));

  const client = new CloudClient(apiUrl);
  const store = defaultCredentialStore();
  const hint = headless ? undefined : "run `specnaut cloud login` (or set SPECNAUT_CLOUD_TOKEN).";
  const token = await requireCloudToken(apiUrl, client, store, hint);
  return token ? printToken(token) : 1;
}

async function runLogout(intent: CloudIntent): Promise<number> {
  const resolved = await resolveApiUrl(intent.apiUrl);
  if (!resolved) return 1;
  const apiUrl = resolved.url;
  await defaultCredentialStore().delete(apiUrl);
  console.log(green(`✓ logged out of ${apiUrl}`));
  return 0;
}
