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
import { CloudClient, type CloudColumn, type CloudTask } from "../../domain/cloud/cloud_client.ts";
import { bindingClient, bindProject } from "./cloud_project_binding.ts";
import { deviceLogin } from "./cloud_login.ts";
import { printToken, requireCloudToken } from "./cloud_token.ts";
import {
  apiUrlRefusal,
  DEFAULT_CLOUD_API_URL,
  normalizeApiUrl,
} from "../../domain/cloud/cloud_config.ts";
import { headlessRefusal, headlessToken } from "../../domain/cloud/headless_token.ts";
import type { CredentialStore } from "../../domain/cloud/credentials.ts";
import { defaultCredentialStore } from "../../infrastructure/credential_store.ts";
import { FsBacklogConfigStore } from "../../infrastructure/fs_backlog_config_store.ts";
import { openInBrowser } from "../../infrastructure/browser_opener.ts";
import { errorText } from "../../domain/terminal_text.ts";

export type CloudIntent = {
  kind: "cloud";
  sub: "login" | "token" | "logout" | "orgs" | "board";
  apiUrl: string | null;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Where a resolved deployment URL came from — drives the login trust
 *  disclosure (#400). `flag` is an explicit user act; `default` is the
 *  CLI-shipped canonical endpoint; `config` is a project file the user may not
 *  have authored (the only phishing-relevant source). */
type ApiUrlSource = "flag" | "config" | "default";

type ResolvedApiUrl = { url: string; source: ApiUrlSource };

/** Resolve the deployment URL: flag → existing config → the canonical default,
 *  tagging the source so `runLogin` can disclose it before authenticating.
 *  Since Specnaut Cloud is a single hosted service, there is always a valid
 *  target — the only refusal is an explicit `--api-url` / `api_url` that is not
 *  a plain one, reported on stderr with its reason, and returned as null. */
async function resolveApiUrl(
  explicit: string | null,
): Promise<ResolvedApiUrl | null> {
  const cfg = explicit ? null : await new FsBacklogConfigStore().readCloudConfig(Deno.cwd());
  const raw = explicit || cfg?.apiUrl;
  if (!raw) return { url: DEFAULT_CLOUD_API_URL, source: "default" };
  const url = normalizeApiUrl(raw);
  if (!url) console.error(red(`error: ${apiUrlRefusal(raw)}`));
  return url ? { url, source: explicit ? "flag" : "config" } : null;
}

const URL_SOURCE_LABEL: Record<ApiUrlSource, string> = {
  flag: "--api-url flag",
  config: "project config (.specnaut/backlog-config.yml)",
  default: "Specnaut Cloud (default)",
};

/** Human label for where a deployment URL came from (login disclosure, #400). */
export function urlSourceLabel(source: ApiUrlSource): string {
  return URL_SOURCE_LABEL[source];
}

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

export async function runCloud(intent: CloudIntent): Promise<number> {
  switch (intent.sub) {
    case "login":
      return await runLogin(intent);
    case "token":
      return await runToken(intent);
    case "logout":
      return await runLogout(intent);
    case "orgs":
      return await runOrgs(intent);
    case "board":
      return await runBoard(intent);
  }
}

/** Resolve the deployment URL (no prompt) + a fresh access token for the
 *  read commands, or print guidance and return a non-zero exit code. The token
 *  is obtained via the keychain-backed refresh flow and never printed. */
async function authedSession(
  intent: CloudIntent,
): Promise<{ client: CloudClient; token: string } | number> {
  const resolved = await resolveApiUrl(intent.apiUrl);
  if (!resolved) return 1;
  const apiUrl = resolved.url;
  const client = new CloudClient(apiUrl);
  const store = defaultCredentialStore();
  const token = await requireCloudToken(
    apiUrl,
    client,
    store,
    "run `specnaut cloud login`: this command does not read SPECNAUT_CLOUD_TOKEN.",
  );
  if (!token) return 1;
  return { client, token };
}

async function runOrgs(intent: CloudIntent): Promise<number> {
  const session = await authedSession(intent);
  if (typeof session === "number") return session;

  let orgs;
  try {
    orgs = await session.client.listOrgs(session.token);
  } catch (e) {
    console.error(red(`error: ${errorText(e)}`));
    return 1;
  }

  if (orgs.length === 0) {
    console.log(dim("No organizations."));
    return 0;
  }
  console.log(bold("Your organizations:"));
  for (const o of orgs) {
    const marker = o.isActive ? green("●") : dim("○");
    const active = o.isActive ? green(" (active)") : "";
    console.log(`  ${marker} ${bold(o.name)} ${dim(o.slug)} — ${o.role}${active}`);
  }
  return 0;
}

async function runBoard(intent: CloudIntent): Promise<number> {
  const cfg = await new FsBacklogConfigStore().readCloudConfig(Deno.cwd());
  const projectKey = cfg?.projectKey;
  if (!projectKey) {
    console.error(red("error: no project linked here."));
    console.error(
      dim("  run `specnaut login` to select a project, or `cd` into a linked project."),
    );
    return 1;
  }

  const session = await authedSession(intent);
  if (typeof session === "number") return session;

  let columns: CloudColumn[];
  let tasks: CloudTask[];
  try {
    [columns, tasks] = await Promise.all([
      session.client.listColumns(session.token, projectKey),
      session.client.listTasks(session.token, projectKey),
    ]);
  } catch (e) {
    console.error(red(`error: ${errorText(e)}`));
    return 1;
  }

  renderBoard(projectKey, columns, tasks);
  return 0;
}

/** Print the board: columns in order, each followed by its tasks. */
function renderBoard(
  projectKey: string,
  columns: CloudColumn[],
  tasks: CloudTask[],
): void {
  const byColumn = new Map<string, CloudTask[]>();
  for (const t of tasks) {
    const list = byColumn.get(t.columnId) ?? [];
    list.push(t);
    byColumn.set(t.columnId, list);
  }

  console.log(bold(`Board — ${projectKey}`));
  for (const col of [...columns].sort((a, b) => a.order - b.order)) {
    const colTasks = byColumn.get(col.id) ?? [];
    console.log(`\n${bold(col.name)} ${dim(`(${colTasks.length})`)}`);
    if (colTasks.length === 0) {
      console.log(dim("  —"));
      continue;
    }
    for (const t of colTasks) {
      const meta = [t.priority, t.size].filter(Boolean).join(" ");
      console.log(`  ${dim(`#${t.number}`)} ${t.title}${meta ? dim(`  [${meta}]`) : ""}`);
    }
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
  const apiUrl = resolved.url;

  // Disclose the target server + where the URL came from BEFORE opening the
  // browser, so a config-supplied (potentially attacker-controlled) api_url is
  // visible and interceptable rather than silently authenticated against (#400).
  console.log("");
  console.log(`  Connecting to:  ${bold(apiUrl)}`);
  console.log(dim(`  Source:         ${urlSourceLabel(resolved.source)}`));

  const { client, store } = bindingClient(apiUrl, defaultCredentialStore());

  if (!await trustedTarget(resolved, store)) return 1;

  const loggedIn = await deviceLogin({
    apiUrl,
    client,
    store,
    io: { log: (m) => console.log(m) },
    openUrl: openInBrowser,
    now: () => Date.now(),
    sleep,
  });
  if (!loggedIn) return 1;
  console.log(green("✓ authenticated with Specnaut Cloud"));
  console.log(
    dim(
      store.kind === "keychain"
        ? "  credentials stored in the OS keychain"
        : "  credentials stored in ~/.specnaut/credentials.json (0600 — no OS keychain available)",
    ),
  );

  return await bindProject(apiUrl, client, store);
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
async function trustedTarget(resolved: ResolvedApiUrl, store: CredentialStore): Promise<boolean> {
  const existing = resolved.source === "config" ? await store.load(resolved.url) : null;
  if (!loginNeedsTrustConfirm(resolved.source, existing !== null)) return true;
  console.log(yellow("  ⚠ this URL comes from the project config, not from you, and you have"));
  console.log(yellow("    never logged in here before."));
  const answer = (prompt("  Authenticate against this server? [y/N]") ?? "").trim().toLowerCase();
  if (answer === "y" || answer === "yes") return true;
  console.error(red("aborted — login cancelled."));
  return false;
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
