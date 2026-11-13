// The project's `.specnaut/backlog-config.yml` for the Cloud backend (#353):
// its shape, its rendering and its parsing. Holds only non-secret coordinates —
// backend, api_url, project_key. Credentials live in the credential store, never
// here. Reading and writing the file is `infrastructure/fs_backlog_config_store.ts`
// (cli#695): the domain does no I/O.

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

/**
 * A plain http(s) API base: dot-separated ASCII host labels (or the IPv6
 * loopback `[::1]`), an optional port and path. An allow-list, because the shell scripts hand this string to curl, which is
 * not the parser `URL` is: anything else may read as two different hosts. The same
 * grammar guards `scripts/cloud/_config.sh` (tests/scripts/cloud_config_sh_test.ts).
 */
const PLAIN_API_URL =
  /^https?:\/\/([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[::1\])(?::[0-9]+)?(?:\/[A-Za-z0-9._~\/-]*)?$/;

/**
 * The hosts plain http may reach. The bearer token travels with every request,
 * and over plain http it crosses the network in clear; loopback traffic never
 * leaves the host. The same set guards `scripts/cloud/_config.sh`.
 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A plain API base, trailing slashes dropped, or null: plain http only to a loopback host. */
export function normalizeApiUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  const host = PLAIN_API_URL.exec(trimmed)?.[1]?.toLowerCase();
  // A host `URL` rewrites (`127.0x.0.1`) is not the one curl reads.
  if (!host || !URL.canParse(trimmed) || new URL(trimmed).hostname !== host) return null;
  return trimmed.startsWith("http://") && !LOOPBACK_HOSTS.has(host) ? null : trimmed;
}

const INVALID_API_URL = "invalid Specnaut Cloud API URL — check --api-url / api_url.";

/**
 * Why `raw` is refused as an API base. A URL whose https form passes is refused
 * for plain http alone, and says so: "invalid" sent its user looking for a typo.
 */
export function apiUrlRefusal(raw: string): string {
  const trimmed = raw.trim();
  const plainHttp = trimmed.startsWith("http://") &&
    normalizeApiUrl(`https://${trimmed.slice("http://".length)}`) !== null;
  return plainHttp
    ? "plain http reaches a loopback host only: the token would cross the network in clear. " +
      "Use https — check --api-url / api_url."
    : INVALID_API_URL;
}

/** An `api_url` is set, and is not a plain http(s) base: not the same as no link at all. */
export class InvalidApiUrl extends Error {
  constructor() {
    super(INVALID_API_URL);
    this.name = "InvalidApiUrl";
  }
}

/** The project's API base: null when none is set, InvalidApiUrl when it is not a plain one. */
export function linkedApiUrl(raw: string): string | null {
  if (!raw.trim()) return null;
  const url = normalizeApiUrl(raw);
  if (!url) throw new InvalidApiUrl();
  return url;
}

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

/**
 * The Cloud coordinates in a `backlog-config.yml` body, or `null` when the text
 * is not a YAML mapping. Pure: reaching the file is the `CloudConfigStore`
 * port's job (cli#695). A malformed file reads as "not Cloud-linked", which is
 * what every cloud command already reports for an unlinked project.
 */
export function parseCloudConfig(text: string): CloudConfig | null {
  let parsed: Record<string, unknown> | null;
  try {
    parsed = parseYaml(text) as Record<string, unknown> | null;
  } catch (err) {
    if (err instanceof SyntaxError) return null;
    throw err;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const remote = parseRemote(parsed.remote);
  return {
    apiUrl: apiUrlValue(parsed.api_url),
    projectKey: typeof parsed.project_key === "string" ? parsed.project_key : "",
    // Only present when the config actually carries a `remote:` block, so a
    // pre-gates config round-trips to the exact same shape (backward compatible).
    ...(remote ? { remote } : {}),
  };
}

/** A value of any other type is a bad api_url, which is not the same as none. */
function apiUrlValue(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  return typeof raw === "string" ? raw : JSON.stringify(raw);
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
