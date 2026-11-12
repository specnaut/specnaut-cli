// After `specnaut cloud login`: bind this project to a Cloud project, picked from the
// account's list or created by name, and write `.specnaut/backlog-config.yml`.

import { bold, dim, green, red } from "@std/fmt/colors";
import { CloudClient, type CloudProject } from "../../domain/cloud/cloud_client.ts";
import { bundledCredentialPatterns } from "../../application/credential_patterns.ts";
import type { CredentialStore } from "../../domain/cloud/credentials.ts";
import { generateProjectKey } from "../../domain/cloud/project_key.ts";
import { FsBacklogConfigStore } from "../../infrastructure/fs_backlog_config_store.ts";
import { makeStdinSelectIO, selectInteractive, type SelectItem } from "../select.ts";
import { requireCloudToken } from "./cloud_token.ts";

/** The client login binds with: it may create a project, so it checks the name it sends. */
export function bindingClient(apiUrl: string): CloudClient {
  return new CloudClient(apiUrl, fetch, bundledCredentialPatterns());
}

/** Bind the project: list, then select or create. */
export async function bindProject(
  apiUrl: string,
  client: CloudClient,
  store: CredentialStore,
): Promise<number> {
  const token = await requireCloudToken(apiUrl, client, store);
  if (!token) return 1;

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

  // The store refuses a path resolving outside the project (cli#574).
  await new FsBacklogConfigStore().writeCloudConfig(Deno.cwd(), apiUrl, projectKey);
  console.log(green(`✓ linked to project ${bold(projectKey)}`));
  console.log(
    dim("  wrote .specnaut/backlog-config.yml — /task now runs against Specnaut Cloud"),
  );
  return 0;
}

/** One entry in the project picker: an existing project, or "create new". */
export type ProjectChoice = { kind: "pick"; key: string } | { kind: "create" };

/**
 * Build the unified picker list — every accessible project followed by a
 * "create a new project" row — as `SelectItem`s. Pure (no I/O) so the label
 * shape and ordering are unit-testable.
 */
export function buildProjectChoices(
  projects: ReadonlyArray<CloudProject>,
): SelectItem<ProjectChoice>[] {
  const items: SelectItem<ProjectChoice>[] = projects.map((p) => ({
    key: { kind: "pick", key: p.key },
    label: `${bold(p.key)} — ${p.name}${p.role ? dim(` (${p.role})`) : ""}`,
  }));
  items.push({ key: { kind: "create" }, label: green("+ Create a new project") });
  return items;
}

/**
 * Bind the project after login: one arrow-key list of the account's projects
 * plus a "create new" row (↑/↓ + enter). Picking a project returns its key;
 * picking "create" asks only for a NAME and derives the key automatically.
 * Returns the chosen key, or null if the user cancelled (Ctrl-C / ESC).
 */
async function chooseProject(
  client: CloudClient,
  token: string,
): Promise<string | null> {
  const projects = await client.listProjects(token);
  // Header is single-line (no embedded "\n") so the picker's redraw height
  // stays exact; the blank spacer line above stays put across redraws.
  const header = projects.length > 0
    ? "Select a Cloud project or create one (↑/↓ to move, enter to select):"
    : "No Cloud projects yet — press enter to create your first:";

  console.log("");
  const picked = await selectInteractive(
    buildProjectChoices(projects),
    0,
    makeStdinSelectIO(),
    header,
  );
  if (picked === null) return null; // cancelled — caller reports "aborted"
  if (picked.kind === "pick") return picked.key;

  return await createProjectFromName(client, token, projects.map((p) => p.key));
}

/**
 * Create a project from a human name alone: derive a valid key via
 * {@link generateProjectKey}, deduping against the keys we already know. If a
 * concurrent create stole the key between our list and our write, the server
 * rejects it with "already exists" — we add it to the taken set and retry with
 * the next suffix. Returns the created key, or null if the user gave no name.
 */
async function createProjectFromName(
  client: CloudClient,
  token: string,
  existingKeys: ReadonlyArray<string>,
): Promise<string | null> {
  const name = (prompt("Project name:") ?? "").trim();
  if (!name) return null;

  const taken = new Set(existingKeys);
  for (let attempt = 0; attempt < 5; attempt++) {
    const key = generateProjectKey(name, taken);
    try {
      const created = await client.createProject(token, key, name);
      console.log(green(`✓ created project ${bold(created.name)} ${dim(`(key ${created.key})`)}`));
      return created.key;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/already exists/i.test(msg)) {
        taken.add(key); // race: someone took this key — bump the suffix and retry
        continue;
      }
      throw e;
    }
  }
  console.error(red("error: couldn't find a free project key — please retry."));
  return null;
}
