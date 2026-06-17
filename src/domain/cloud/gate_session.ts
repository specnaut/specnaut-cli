// Gate session orchestration (#357): the composable open → await → apply loop a
// skill phase drives, plus cancel. All IO is injected — the GateClient (HTTP), a
// token provider (transparent refresh), a clock, and sleep — so the whole loop is
// unit-testable with a fake clock and no network.
//
// The CLI is the *agent*: it opens a gate, polls until a human resolves it from
// elsewhere, returns the typed answer, and acknowledges (apply). It never resolves
// a gate itself. Awaiting ALWAYS terminates — answered, cancelled, unresolved
// (timeout), or error — never an unbounded hang (FR-003 / SC-003).

import { type Gate, type GateRequest, validatePayload } from "./gate_contract.ts";
import { GateApiError, GateClient, type GateErrorReason } from "./gate_client.ts";
import { type RemoteMode, resolveRemoteMode } from "./remote_mode.ts";
import { CloudClient, type FetchFn } from "./cloud_client.ts";
import { freshAccessToken } from "./auth_flow.ts";
import type { CloudConfig } from "./cloud_config.ts";
import type { CredentialStore } from "../../infrastructure/credential_store.ts";

/** Typed result of awaiting / applying / cancelling. */
export type ResolutionOutcome =
  | { kind: "answered"; gate: Gate; answer: Record<string, unknown> }
  | { kind: "applied"; gate: Gate }
  | { kind: "cancelled"; gate: Gate }
  | { kind: "unresolved" } // await timed out
  | { kind: "error"; reason: GateErrorReason | "no_remote" };

/** A valid bearer token, or null when the user must re-authenticate. */
export type TokenProvider = () => Promise<string | null>;

export type GateSessionDeps = {
  projectKey: string;
  client: GateClient;
  remote: RemoteMode;
  token: TokenProvider;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

// Transient-failure backoff inside the await loop: start at the poll interval,
// grow additively, cap so a long outage still polls periodically.
const BACKOFF_STEP_MS = 5_000;
const BACKOFF_CAP_MS = 60_000;

export class GateSession {
  constructor(private readonly deps: GateSessionDeps) {}

  /** The resolved remote-mode setting — callers check `.enabled` before raising. */
  get remote(): RemoteMode {
    return this.deps.remote;
  }

  /**
   * Open a gate and block until it is resolved. Returns the typed answer
   * (`answered`), or a terminal outcome: `cancelled` (someone withdrew it),
   * `unresolved` (await timeout), or `error` (auth / prerequisites / invalid).
   * Requires remote mode to be enabled — a disabled session is a misuse and
   * returns `{ error: "no_remote" }` (the caller checks `remote.enabled` first).
   */
  async raiseAndAwait(req: GateRequest): Promise<ResolutionOutcome> {
    const { projectKey, client, remote, token, now, sleep } = this.deps;

    if (!remote.enabled) return { kind: "error", reason: "no_remote" };

    const check = validatePayload(req.type, req.payload);
    if (!check.ok) return { kind: "error", reason: "invalid" };

    let tok = await token();
    if (!tok) return { kind: "error", reason: "no_remote" }; // no creds ⇒ prerequisites unmet

    let gate: Gate;
    try {
      gate = await client.open(tok, { ...req, projectKey });
    } catch (e) {
      return errorOutcome(e);
    }

    const deadline = now() + remote.awaitTimeoutMs;
    let backoffMs = 0;
    while (now() < deadline) {
      await sleep(remote.pollIntervalMs + backoffMs);
      // Refresh the token each poll cycle so a long await survives expiry (SC-007).
      const fresh = await token();
      if (fresh) tok = fresh;
      else if (!tok) return { kind: "error", reason: "unauthorized" };

      let probed: Gate | null;
      try {
        probed = await client.get(tok, projectKey, gate.id);
        backoffMs = 0; // success — reset backoff
      } catch (e) {
        const reason = reasonOf(e);
        if (reason === "transient") {
          backoffMs = Math.min(backoffMs + BACKOFF_STEP_MS, BACKOFF_CAP_MS);
          continue; // tolerate flaps; keep awaiting until the overall deadline
        }
        if (reason === "unauthorized") {
          // One transparent retry already happened via token(); a hard 401 means
          // the credential is unrecoverable.
          return { kind: "error", reason: "unauthorized" };
        }
        return errorOutcome(e);
      }

      if (!probed) continue; // not visible yet
      if (probed.state === "answered" || probed.state === "applied") {
        return { kind: "answered", gate: probed, answer: probed.answer ?? {} };
      }
      if (probed.state === "cancelled") return { kind: "cancelled", gate: probed };
      // still open → keep polling
    }
    return { kind: "unresolved" };
  }

  /**
   * Acknowledge consumption of an answered gate (answered → applied). Idempotent —
   * re-applying an already-applied gate is a success no-op (FR-004 / SC-002).
   */
  async apply(gate: Gate): Promise<ResolutionOutcome> {
    const { projectKey, client, token } = this.deps;
    const tok = await token();
    if (!tok) return { kind: "error", reason: "unauthorized" };
    try {
      const applied = await client.apply(tok, projectKey, gate.id);
      return { kind: "applied", gate: applied };
    } catch (e) {
      return errorOutcome(e);
    }
  }

  /** Withdraw an open gate the agent no longer needs (open → cancelled). */
  async cancel(id: string): Promise<ResolutionOutcome> {
    const { projectKey: _projectKey, client, token } = this.deps;
    const tok = await token();
    if (!tok) return { kind: "error", reason: "unauthorized" };
    try {
      const cancelled = await client.cancel(tok, id);
      return { kind: "cancelled", gate: cancelled };
    } catch (e) {
      return errorOutcome(e);
    }
  }
}

/**
 * One-call factory a skill phase uses to obtain a ready GateSession from the
 * project's Cloud config + credentials (FR-012). It resolves remote mode (config
 * + SPECNAUT_REMOTE), builds the gate client, and wires a token provider that
 * refreshes transparently via the existing device-auth flow. `fetchFn`, `now`,
 * `sleep`, and `env` are injectable so callers/tests can substitute them.
 *
 * Returns `null` when the project isn't Cloud-linked (no api_url/project_key) —
 * the caller treats that as "handle locally". The returned session may still be
 * remote-disabled (`session.remote.enabled === false`); callers check that to
 * decide remote vs local before raising a gate.
 */
export function makeGateSession(deps: {
  config: CloudConfig;
  store: CredentialStore;
  env?: (key: string) => string | undefined;
  fetchFn?: FetchFn;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): GateSession | null {
  const { config, store } = deps;
  if (!config.apiUrl || !config.projectKey) return null;

  const env = deps.env ?? ((k) => Deno.env.get(k));
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const fetchFn = deps.fetchFn ?? fetch;

  // Read the new SPECNAUT_* names, falling back to the legacy SPECFLOW_*
  // names so existing users' headless setups keep working post-rebrand.
  const remote = resolveRemoteMode(
    config.remote,
    env("SPECNAUT_REMOTE") ?? env("SPECFLOW_REMOTE"),
  );
  const cloudClient = new CloudClient(config.apiUrl, fetchFn);
  const gateClient = new GateClient(config.apiUrl, fetchFn);

  // Headless escape hatch: an explicit SPECNAUT_CLOUD_TOKEN short-circuits the
  // stored-credential refresh path, mirroring `specnaut cloud token`. The legacy
  // SPECFLOW_CLOUD_TOKEN name is still honored as a fallback.
  const headlessToken = env("SPECNAUT_CLOUD_TOKEN") ?? env("SPECFLOW_CLOUD_TOKEN");
  const token: TokenProvider = headlessToken && headlessToken.trim() !== ""
    ? () => Promise.resolve(headlessToken)
    : () => freshAccessToken({ apiUrl: config.apiUrl, client: cloudClient, store, now });

  return new GateSession({
    projectKey: config.projectKey,
    client: gateClient,
    remote,
    token,
    now,
    sleep,
  });
}

function reasonOf(e: unknown): GateErrorReason | "unknown" {
  return e instanceof GateApiError ? e.reason : "unknown";
}

function errorOutcome(e: unknown): ResolutionOutcome {
  if (e instanceof GateApiError) return { kind: "error", reason: e.reason };
  return { kind: "error", reason: "transient" };
}
