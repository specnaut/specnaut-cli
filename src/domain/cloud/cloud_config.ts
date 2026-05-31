// Read/write the project's `.specflow/backlog-config.yml` for the Cloud backend
// (#353). Holds only non-secret coordinates — backend, api_url, project_key.
// Credentials live in the credential store, never here.

import { parse as parseYaml } from "@std/yaml";

export type CloudConfig = {
  apiUrl: string;
  projectKey: string;
};

/** Render the Cloud `backlog-config.yml` body (no secret). */
export function renderCloudConfig(apiUrl = "", projectKey = ""): string {
  return [
    "# backlog-config.yml — Specflow Cloud backend",
    "# Credentials are NOT stored here. They live in your OS keychain (or a",
    "# 0600 file under ~/.specflow). Run `specflow cloud login` to authenticate.",
    "backend: cloud",
    `api_url: ${
      JSON.stringify(apiUrl)
    }        # Specflow Cloud API base, e.g. https://your-deployment.convex.site`,
    `project_key: ${JSON.stringify(projectKey)}    # the project's short key, e.g. CLOUD`,
    "",
  ].join("\n");
}

/** Read the Cloud config from a project dir, or null if absent/unreadable. */
export async function readCloudConfig(projectDir: string): Promise<CloudConfig | null> {
  const path = `${projectDir}/.specflow/backlog-config.yml`;
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch {
    return null;
  }
  try {
    const parsed = parseYaml(text) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      apiUrl: typeof parsed.api_url === "string" ? parsed.api_url : "",
      projectKey: typeof parsed.project_key === "string" ? parsed.project_key : "",
    };
  } catch {
    return null;
  }
}

/** Write the Cloud config (api_url + project_key) into a project dir. */
export async function writeCloudConfig(
  projectDir: string,
  apiUrl: string,
  projectKey: string,
): Promise<void> {
  await Deno.mkdir(`${projectDir}/.specflow`, { recursive: true });
  await Deno.writeTextFile(
    `${projectDir}/.specflow/backlog-config.yml`,
    renderCloudConfig(apiUrl, projectKey),
  );
}
