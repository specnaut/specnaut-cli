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
import { GateApiError, GateClient, type GateErrorReason, gateReasonOf } from "./gate_client.ts";
import { type RemoteMode, resolveRemoteMode } from "./remote_mode.ts";
import {
  CloudApiError,
  CloudClient,
  type FetchFn,
  isRedirected,
  isUnavailable,
} from "./cloud_client.ts";
import { accessToken, sessionToken } from "./auth_flow.ts";
import { type CloudConfig, linkedApiUrl } from "./cloud_config.ts";
import { type CredentialStore, watchedStore } from "./credentials.ts";
import type { CredentialPatterns } from "./credential_check.ts";

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

/** Why a session has no token to send. */
type NoToken = Extract<ResolutionOutcome, { kind: "error" }>;

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
    const { projectKey, client, remote, now, sleep } = this.deps;

    if (!remote.enabled) return { kind: "error", reason: "no_remote" };

    const check = validatePayload(req.type, req.payload);
    if (!check.ok) return { kind: "error", reason: "invalid" };

    const first = await this.bearer("no_remote"); // no creds ⇒ prerequisites unmet
    if (typeof first !== "string") return first;
    let tok = first;

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
      const fresh = await this.bearer("unauthorized");
      if (typeof fresh === "string") tok = fresh;
      else if (fresh.reason === "redirected") return fresh; // retrying changes nothing
      const stale = typeof fresh !== "string" && fresh.reason !== "unauthorized";

      const probed = await this.probe(tok, gate.id, stale);
      if (probed === "retry") {
        backoffMs = Math.min(backoffMs + BACKOFF_STEP_MS, BACKOFF_CAP_MS);
        continue; // tolerate flaps; keep awaiting until the overall deadline
      }
      if (probed && "kind" in probed) return probed;
      backoffMs = 0; // success — reset backoff

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
   * One poll: the gate (null if not visible yet), "retry" for a flap the await tolerates, or
   * the error ending it. A hard 401 means the credential is unrecoverable, unless the last
   * refresh got no verdict (`stale`): then it only says the token in hand expired.
   */
  private async probe(
    tok: string,
    id: string,
    stale: boolean,
  ): Promise<Gate | null | "retry" | ResolutionOutcome> {
    try {
      return await this.deps.client.get(tok, this.deps.projectKey, id);
    } catch (e) {
      const reason = gateReasonOf(e);
      const flap = reason === "transient" || reason === "unexpected";
      if (flap || (reason === "unauthorized" && stale)) return "retry";
      return reason === "unauthorized" ? { kind: "error", reason } : errorOutcome(e);
    }
  }

  /** The token, or why there is none: `missing` when logged out, else what kept Cloud from giving a verdict. */
  private async bearer(missing: "no_remote" | "unauthorized"): Promise<string | NoToken> {
    try {
      return (await this.deps.token()) ?? { kind: "error", reason: missing };
    } catch (e) {
      if (!(e instanceof CloudApiError)) throw e;
      if (isRedirected(e)) return { kind: "error", reason: "redirected" };
      return { kind: "error", reason: isUnavailable(e) ? "transient" : "unexpected" };
    }
  }

  /**
   * Acknowledge consumption of an answered gate (answered → applied). Idempotent —
   * re-applying an already-applied gate is a success no-op (FR-004 / SC-002).
   */
  async apply(gate: Gate): Promise<ResolutionOutcome> {
    const { projectKey, client } = this.deps;
    const tok = await this.bearer("unauthorized");
    if (typeof tok !== "string") return tok;
    try {
      const applied = await client.apply(tok, projectKey, gate.id);
      return { kind: "applied", gate: applied };
    } catch (e) {
      return errorOutcome(e);
    }
  }

  /** Withdraw an open gate the agent no longer needs (open → cancelled). */
  async cancel(id: string): Promise<ResolutionOutcome> {
    const { client } = this.deps;
    const tok = await this.bearer("unauthorized");
    if (typeof tok !== "string") return tok;
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
 * refreshes transparently via the existing device-auth flow. `env` is required —
 * the caller supplies the environment — and `fetchFn`, `now` and `sleep` are
 * injectable so callers/tests can substitute them.
 *
 * Returns `null` when the project isn't Cloud-linked (no api_url/project_key) —
 * the caller treats that as "handle locally"; an api_url that is set and not plain
 * throws InvalidApiUrl. The returned session may still be
 * remote-disabled (`session.remote.enabled === false`); callers check that to
 * decide remote vs local before raising a gate.
 */
export function makeGateSession(deps: {
  config: CloudConfig;
  store: CredentialStore;
  /** The environment lookup, injected: the domain never reads `Deno.env` (cli#695). */
  env: (key: string) => string | undefined;
  /** Told why a headless token was withheld; the domain prints nothing itself. */
  warn?: (msg: string) => void;
  /** What the clients check written text with; without it, no written text is sent. */
  patterns?: CredentialPatterns;
  fetchFn?: FetchFn;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): GateSession | null {
  const { config, env } = deps;
  const { store, held } = watchedStore(deps.store);
  const apiUrl = linkedApiUrl(config.apiUrl);
  if (!apiUrl || !config.projectKey) return null;

  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const fetchFn = deps.fetchFn ?? fetch;

  // Read the new SPECNAUT_* names, falling back to the legacy SPECFLOW_*
  // names so existing users' headless setups keep working post-rebrand.
  const remote = resolveRemoteMode(
    config.remote,
    env("SPECNAUT_REMOTE") ?? env("SPECFLOW_REMOTE"),
  );
  const cloudClient = new CloudClient(apiUrl, fetchFn);
  const gateClient = new GateClient(apiUrl, fetchFn, deps.patterns, held);

  // SPECNAUT_CLOUD_TOKEN, for a deployment it may go to only; else the stored login.
  const stored = () => accessToken({ apiUrl, client: cloudClient, store, now });
  const token: TokenProvider = sessionToken(apiUrl, env, stored, deps.warn);

  return new GateSession({
    projectKey: config.projectKey,
    client: gateClient,
    remote,
    token,
    now,
    sleep,
  });
}

function errorOutcome(e: unknown): ResolutionOutcome {
  if (e instanceof GateApiError) return { kind: "error", reason: e.reason };
  throw e; // Not Cloud's answer: a refusal before the request, or a bug, is never "transient".
}
