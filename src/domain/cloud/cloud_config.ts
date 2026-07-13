// Read/write the project's `.specnaut/backlog-config.yml` for the Cloud backend
// (#353). Holds only non-secret coordinates — backend, api_url, project_key.
// Credentials live in the credential store, never here.

import { parse as parseYaml } from "@std/yaml";
import type { RemoteConfig } from "./remote_mode.ts";

/** The canonical Specnaut Cloud API endpoint. Specnaut Cloud is a single hosted
 *  service, so the CLI defaults here — `specnaut cloud login` needs no URL and
 *  no user ever sees the underlying deployment host. `--api-url` (or an
 *  `api_url` in `backlog-config.yml`) overrides it for dev / self-hosted use. */
export const DEFAULT_CLOUD_API_URL = "https://api.specnaut.com";

export type CloudConfig = {
  apiUrl: string;
  projectKey: string;
  // Optional remote-gate settings (#357). Absent ⇒ remote mode off (the default),
  // fully backward compatible with configs written before gates existed.
  remote?: RemoteConfig;
};

/** Render the Cloud `backlog-config.yml` body (no secret). */
export function renderCloudConfig(apiUrl = "", projectKey = ""): string {
  return [
    "# backlog-config.yml — Specnaut Cloud backend",
    "# Credentials are NOT stored here. They live in your OS keychain (or a",
    "# 0600 file under ~/.specnaut). Run `specnaut cloud login` to authenticate.",
    "backend: cloud",
    `api_url: ${
      JSON.stringify(apiUrl)
    }        # Specnaut Cloud API base (optional; defaults to ${DEFAULT_CLOUD_API_URL})`,
    `project_key: ${JSON.stringify(projectKey)}    # the project's short key, e.g. CLOUD`,
    "",
    "# Remote-control gates (#357) — opt-in. When enabled, a headless agent raises",
    "# blocking decisions as gates you resolve from anywhere (e.g. your phone)",
    "# instead of prompting at the terminal. Override per-run with SPECNAUT_REMOTE=1.",
    "# remote:",
    "#   enabled: false",
    "#   await_timeout_s: 1800   # overall wait bound (default 1800)",
    "#   poll_interval_s: 5      # base poll cadence (default 5)",
    "",
  ].join("\n");
}

/** Read the Cloud config from a project dir, or null if absent/unreadable. */
export async function readCloudConfig(projectDir: string): Promise<CloudConfig | null> {
  const path = `${projectDir}/.specnaut/backlog-config.yml`;
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch {
    return null;
  }
  try {
    const parsed = parseYaml(text) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return null;
    const remote = parseRemote(parsed.remote);
    return {
      apiUrl: typeof parsed.api_url === "string" ? parsed.api_url : "",
      projectKey: typeof parsed.project_key === "string" ? parsed.project_key : "",
      // Only present when the config actually carries a `remote:` block, so a
      // pre-gates config round-trips to the exact same shape (backward compatible).
      ...(remote ? { remote } : {}),
    };
  } catch {
    return null;
  }
}

/** Project the optional `remote:` YAML block into a RemoteConfig (snake → camel). */
function parseRemote(raw: unknown): CloudConfig["remote"] {
  if (typeof raw !== "object" || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  return {
    enabled: o.enabled === true,
    awaitTimeoutS: num(o.await_timeout_s),
    pollIntervalS: num(o.poll_interval_s),
  };
}

/** Write the Cloud config (api_url + project_key) into a project dir. */
export async function writeCloudConfig(
  projectDir: string,
  apiUrl: string,
  projectKey: string,
): Promise<void> {
  await Deno.mkdir(`${projectDir}/.specnaut`, { recursive: true });
  await Deno.writeTextFile(
    `${projectDir}/.specnaut/backlog-config.yml`,
    renderCloudConfig(apiUrl, projectKey),
  );
}
