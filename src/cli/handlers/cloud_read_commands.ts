// `specnaut cloud orgs` and `specnaut cloud board`: the read commands, which run on
// the stored login only — SPECNAUT_CLOUD_TOKEN serves `cloud token`, not these.

import { bold, dim, green, red } from "@std/fmt/colors";
import {
  CloudClient,
  type CloudColumn,
  type CloudOrg,
  type CloudTask,
} from "../../domain/cloud/cloud_client.ts";
import { errorText } from "../../domain/terminal_text.ts";
import { defaultCredentialStore } from "../../infrastructure/credential_store.ts";
import { FsBacklogConfigStore } from "../../infrastructure/fs_backlog_config_store.ts";
import { resolveApiUrl } from "./cloud_api_url.ts";
import { requireCloudToken } from "./cloud_token.ts";

type Session = { client: CloudClient; token: string };

/** Resolve the deployment URL (no prompt) + a fresh access token for the
 *  read commands, or print guidance and return a non-zero exit code. The token
 *  is obtained via the keychain-backed refresh flow and never printed. */
async function authedSession(apiUrl: string | null): Promise<Session | number> {
  const resolved = await resolveApiUrl(apiUrl);
  if (!resolved) return 1;
  const client = new CloudClient(resolved.url);
  const token = await requireCloudToken(
    resolved.url,
    client,
    defaultCredentialStore(),
    "run `specnaut cloud login`: this command does not read SPECNAUT_CLOUD_TOKEN.",
  );
  if (!token) return 1;
  return { client, token };
}

export async function runOrgs(apiUrl: string | null): Promise<number> {
  const session = await authedSession(apiUrl);
  if (typeof session === "number") return session;
  let orgs;
  try {
    orgs = await session.client.listOrgs(session.token);
  } catch (e) {
    console.error(red(`error: ${errorText(e)}`));
    return 1;
  }
  printOrgs(orgs);
  return 0;
}

/** The account's organizations, the active one flagged. */
export function printOrgs(orgs: readonly CloudOrg[]): void {
  if (orgs.length === 0) {
    console.log(dim("No organizations."));
    return;
  }
  console.log(bold("Your organizations:"));
  for (const o of orgs) {
    const marker = o.isActive ? green("●") : dim("○");
    const active = o.isActive ? green(" (active)") : "";
    console.log(`  ${marker} ${bold(o.name)} ${dim(o.slug)} — ${o.role}${active}`);
  }
}

export async function runBoard(apiUrl: string | null): Promise<number> {
  const projectKey = await linkedProjectKey();
  if (!projectKey) return 1;
  const session = await authedSession(apiUrl);
  if (typeof session === "number") return session;
  let board: [CloudColumn[], CloudTask[]];
  try {
    board = await Promise.all([
      session.client.listColumns(session.token, projectKey),
      session.client.listTasks(session.token, projectKey),
    ]);
  } catch (e) {
    console.error(red(`error: ${errorText(e)}`));
    return 1;
  }
  renderBoard(projectKey, ...board);
  return 0;
}

/** The project linked in this folder, or null once the user is told how to link one. */
async function linkedProjectKey(): Promise<string | null> {
  const cfg = await new FsBacklogConfigStore().readCloudConfig(Deno.cwd());
  if (cfg?.projectKey) return cfg.projectKey;
  console.error(red("error: no project linked here."));
  console.error(
    dim("  run `specnaut login` to select a project, or `cd` into a linked project."),
  );
  return null;
}

/** Print the board: columns in order, each followed by its tasks. */
export function renderBoard(
  projectKey: string,
  columns: readonly CloudColumn[],
  tasks: readonly CloudTask[],
): void {
  const byColumn = Map.groupBy(tasks, (t) => t.columnId);
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
