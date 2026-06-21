// `specnaut cloud <login|token|logout|orgs|board>` (#353, #398) — the CLI side
// of the Specnaut Cloud backlog backend's interactive auth + read commands.
//
//   login   device-authorization browser flow → stores credentials securely,
//           then binds the project to a Cloud project (select or create) and
//           writes .specnaut/backlog-config.yml. Also reachable as the
//           top-level `specnaut login` alias.
//   token   prints a fresh access token to stdout (refreshing transparently);
//           used by the bundled cloud/*.sh scripts. Honors SPECNAUT_CLOUD_TOKEN
//           (legacy SPECFLOW_CLOUD_TOKEN as a fallback) as a headless / CI
//           escape hatch.
//   logout  removes the stored credentials for the deployment.
//   orgs    lists the account's organizations (active one flagged).
//   board   shows the linked project's board, tasks grouped by column.

import { bold, dim, green, red, yellow } from "@std/fmt/colors";
import { CloudClient, type CloudColumn, type CloudTask } from "../../domain/cloud/cloud_client.ts";
import { freshAccessToken, login } from "../../domain/cloud/auth_flow.ts";
import { readCloudConfig, writeCloudConfig } from "../../domain/cloud/cloud_config.ts";
import { defaultCredentialStore } from "../../infrastructure/credential_store.ts";
import { openInBrowser } from "../../infrastructure/browser_opener.ts";

export type CloudIntent = {
  kind: "cloud";
  sub: "login" | "token" | "logout" | "orgs" | "board";
  apiUrl: string | null;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Accept only well-formed http(s) URLs — guards against file:// / SSRF-y
 *  schemes reaching fetch / the refresh endpoint where the token is sent. */
function normalizeApiUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return trimmed;
  } catch {
    return null;
  }
}

/** Resolve the deployment URL: flag → existing config → (login only) prompt. */
async function resolveApiUrl(
  explicit: string | null,
  allowPrompt: boolean,
): Promise<string | null> {
  if (explicit) return normalizeApiUrl(explicit);
  const cfg = await readCloudConfig(Deno.cwd());
  if (cfg?.apiUrl) return normalizeApiUrl(cfg.apiUrl);
  if (allowPrompt && Deno.stdin.isTerminal()) {
    const v = prompt("Specnaut Cloud API URL (e.g. https://your-deployment.convex.site):");
    if (v && v.trim()) return normalizeApiUrl(v);
  }
  return null;
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
  const apiUrl = await resolveApiUrl(intent.apiUrl, false);
  if (!apiUrl) {
    console.error(
      red(
        "error: no Specnaut Cloud API URL (pass --api-url or set api_url in backlog-config.yml).",
      ),
    );
    return 1;
  }
  const client = new CloudClient(apiUrl);
  const store = defaultCredentialStore();
  const token = await freshAccessToken({ apiUrl, client, store, now: () => Date.now() });
  if (!token) {
    console.error(red("error: not authenticated with Specnaut Cloud."));
    console.error(dim("  run `specnaut login` (or set SPECNAUT_CLOUD_TOKEN)."));
    return 1;
  }
  return { client, token };
}

async function runOrgs(intent: CloudIntent): Promise<number> {
  const session = await authedSession(intent);
  if (typeof session === "number") return session;

  let orgs;
  try {
    orgs = await session.client.listOrgs(session.token);
  } catch (e) {
    console.error(red(`error: ${e instanceof Error ? e.message : String(e)}`));
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
  const cfg = await readCloudConfig(Deno.cwd());
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
    console.error(red(`error: ${e instanceof Error ? e.message : String(e)}`));
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

async function runLogin(intent: CloudIntent): Promise<number> {
  if (!Deno.stdin.isTerminal()) {
    console.error(
      red("error: `specnaut cloud login` needs an interactive terminal."),
    );
    console.error(
      dim("  For CI / headless use, set SPECNAUT_CLOUD_TOKEN to a Cloud API token instead."),
    );
    return 2;
  }

  const apiUrl = await resolveApiUrl(intent.apiUrl, true);
  if (!apiUrl) {
    console.error(red("error: no Specnaut Cloud API URL (pass --api-url <url>)."));
    return 2;
  }

  const client = new CloudClient(apiUrl);
  const store = defaultCredentialStore();

  const result = await login({
    apiUrl,
    client,
    store,
    io: { log: (m) => console.log(m) },
    openUrl: openInBrowser,
    now: () => Date.now(),
    sleep,
  });

  if (!result.ok) {
    const reason = {
      denied: "authorization was denied.",
      expired: "the code expired before approval.",
      timeout: "timed out waiting for approval.",
      invalid: "the authorization request was invalid.",
    }[result.reason];
    console.error(red(`error: ${reason} Run \`specnaut cloud login\` to try again.`));
    return 1;
  }
  console.log(green("✓ authenticated with Specnaut Cloud"));
  console.log(
    dim(
      store.kind === "keychain"
        ? "  credentials stored in the OS keychain"
        : "  credentials stored in ~/.specnaut/credentials.json (0600 — no OS keychain available)",
    ),
  );

  // Bind the project: list, then select or create.
  const token = await freshAccessToken({ apiUrl, client, store, now: () => Date.now() });
  if (!token) {
    console.error(red("error: lost the session right after login — please retry."));
    return 1;
  }

  let projectKey: string | null = null;
  try {
    projectKey = await chooseProject(client, token);
  } catch (e) {
    console.error(red(`error: ${e instanceof Error ? e.message : String(e)}`));
    return 1;
  }
  if (!projectKey) {
    console.error(red("aborted — no project selected."));
    return 1;
  }

  await writeCloudConfig(Deno.cwd(), apiUrl, projectKey);
  console.log(green(`✓ linked to project ${bold(projectKey)}`));
  console.log(
    dim("  wrote .specnaut/backlog-config.yml — /backlog now runs against Specnaut Cloud"),
  );
  return 0;
}

/** Interactive project selection or inline creation. Returns the chosen key. */
async function chooseProject(
  client: CloudClient,
  token: string,
): Promise<string | null> {
  const projects = await client.listProjects(token);

  if (projects.length > 0) {
    console.log("\nYour Cloud projects:");
    projects.forEach((p, i) => {
      console.log(`  ${i + 1}) ${bold(p.key)} — ${p.name}${p.role ? dim(` (${p.role})`) : ""}`);
    });
    console.log(`  n) create a new project`);
    const choice = (prompt("Select [1-" + projects.length + "] or 'n':") ?? "").trim();
    if (choice && choice !== "n" && choice !== "N") {
      const idx = Number(choice) - 1;
      if (Number.isInteger(idx) && idx >= 0 && idx < projects.length) {
        return projects[idx].key;
      }
      console.error(yellow("  not a valid choice — creating a new project instead."));
    }
  } else {
    console.log(dim("\nNo Cloud projects yet — let's create one."));
  }

  const key = (prompt("New project key (2–10 uppercase, e.g. CLOUD):") ?? "").trim();
  if (!key) return null;
  const name = (prompt("Project name:") ?? "").trim() || key;
  const created = await client.createProject(token, key, name);
  console.log(green(`✓ created project ${bold(created.key)}`));
  return created.key;
}

async function runToken(intent: CloudIntent): Promise<number> {
  // Headless / CI escape hatch: an explicit token wins, no store needed.
  // Honor the new SPECNAUT_CLOUD_TOKEN, falling back to the legacy name.
  const envToken = Deno.env.get("SPECNAUT_CLOUD_TOKEN") ?? Deno.env.get("SPECFLOW_CLOUD_TOKEN");
  if (envToken && envToken.trim()) {
    console.log(envToken.trim());
    return 0;
  }

  const apiUrl = await resolveApiUrl(intent.apiUrl, false);
  if (!apiUrl) {
    console.error(
      red(
        "error: no Specnaut Cloud API URL (pass --api-url or set api_url in backlog-config.yml).",
      ),
    );
    return 1;
  }

  const client = new CloudClient(apiUrl);
  const store = defaultCredentialStore();
  const token = await freshAccessToken({ apiUrl, client, store, now: () => Date.now() });
  if (!token) {
    console.error(red("error: not authenticated with Specnaut Cloud."));
    console.error(dim("  run `specnaut cloud login` (or set SPECNAUT_CLOUD_TOKEN)."));
    return 1;
  }
  console.log(token);
  return 0;
}

async function runLogout(intent: CloudIntent): Promise<number> {
  const apiUrl = await resolveApiUrl(intent.apiUrl, false);
  if (!apiUrl) {
    console.error(red("error: no Specnaut Cloud API URL to log out of."));
    return 1;
  }
  await defaultCredentialStore().delete(apiUrl);
  console.log(green(`✓ logged out of ${apiUrl}`));
  return 0;
}
