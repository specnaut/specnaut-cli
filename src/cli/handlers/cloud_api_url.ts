// Which Specnaut Cloud deployment a `specnaut cloud` command talks to, and where
// that choice came from: the source is what the login trust disclosure reads (#400).

import { red } from "@std/fmt/colors";
import {
  apiUrlRefusal,
  DEFAULT_CLOUD_API_URL,
  normalizeApiUrl,
} from "../../domain/cloud/cloud_config.ts";
import { FsBacklogConfigStore } from "../../infrastructure/fs_backlog_config_store.ts";

/** Where a resolved deployment URL came from — drives the login trust
 *  disclosure (#400). `flag` is an explicit user act; `default` is the
 *  CLI-shipped canonical endpoint; `config` is a project file the user may not
 *  have authored (the only phishing-relevant source). */
export type ApiUrlSource = "flag" | "config" | "default";

export type ResolvedApiUrl = { url: string; source: ApiUrlSource };

/** Resolve the deployment URL: flag → existing config → the canonical default,
 *  tagging the source so `runLogin` can disclose it before authenticating.
 *  Since Specnaut Cloud is a single hosted service, there is always a valid
 *  target — the only refusal is an explicit `--api-url` / `api_url` that is not
 *  a plain one, reported on stderr with its reason, and returned as null. */
export async function resolveApiUrl(
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
