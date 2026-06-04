// Resolve the CLI's "remote mode" switch (#357): whether a headless agent raises
// a blocking decision as a *remote gate* (resolvable from a phone) or falls back
// to today's local handling. PURE — the environment is injected.
//
// Precedence (most to least specific):
//   1. SPECFLOW_REMOTE env override  — for headless / CI without editing files
//   2. `remote.enabled` in backlog-config.yml
//   3. default: OFF (byte-for-byte current behaviour — FR-010)
//
// This mirrors the existing SPECFLOW_CLOUD_TOKEN headless escape hatch.

/** The optional `remote:` block of CloudConfig (all fields optional). */
export type RemoteConfig = {
  enabled?: boolean;
  awaitTimeoutS?: number;
  pollIntervalS?: number;
};

/** The resolved, ready-to-use remote-mode setting (times in ms). */
export type RemoteMode = {
  enabled: boolean;
  awaitTimeoutMs: number;
  pollIntervalMs: number;
};

/** Default overall await bound: 30 min — generous (a human on a phone) but finite. */
export const DEFAULT_AWAIT_TIMEOUT_MS = 30 * 60 * 1000;
/** Default base poll cadence: 5s — matches the device-flow / RFC 8628 floor. */
export const DEFAULT_POLL_INTERVAL_MS = 5_000;

// Clamp the poll cadence so a misconfigured file can't induce a tight loop, and
// the timeout so it can't wedge a session for days.
const MIN_POLL_INTERVAL_MS = 1_000;
const MAX_POLL_INTERVAL_MS = 60_000;
const MIN_AWAIT_TIMEOUT_MS = 5_000;
const MAX_AWAIT_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/** Parse an env flag into an explicit boolean, or null when unset/unrecognised. */
export function parseEnvFlag(raw: string | undefined): boolean | null {
  if (raw === undefined) return null;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "off" || v === "no" || v === "") return false;
  return null; // unrecognised → defer to config rather than guess
}

function clamp(n: number | undefined, def: number, lo: number, hi: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Resolve the effective remote mode from config + the SPECFLOW_REMOTE env value.
 * `envValue` is the raw string (or undefined) — injected so this stays pure.
 */
export function resolveRemoteMode(
  config: RemoteConfig | undefined,
  envValue: string | undefined,
): RemoteMode {
  const envFlag = parseEnvFlag(envValue);
  const enabled = envFlag !== null ? envFlag : config?.enabled === true;
  return {
    enabled,
    awaitTimeoutMs: clamp(
      config?.awaitTimeoutS !== undefined ? config.awaitTimeoutS * 1000 : undefined,
      DEFAULT_AWAIT_TIMEOUT_MS,
      MIN_AWAIT_TIMEOUT_MS,
      MAX_AWAIT_TIMEOUT_MS,
    ),
    pollIntervalMs: clamp(
      config?.pollIntervalS !== undefined ? config.pollIntervalS * 1000 : undefined,
      DEFAULT_POLL_INTERVAL_MS,
      MIN_POLL_INTERVAL_MS,
      MAX_POLL_INTERVAL_MS,
    ),
  };
}
