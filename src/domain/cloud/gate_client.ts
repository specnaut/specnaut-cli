// HTTP client for the public gate endpoints (docs/api/gates.md, #356; backend
// #17). A sibling of CloudClient: same `{base}/api/v1` surface, same injectable
// `FetchFn`, same `Authorization: Bearer` scheme. It implements only the *agent*
// verbs — open / get / apply / cancel. It never calls `resolve` (the human
// action). `fetch` is injectable for tests.
//
// Constitution § I: this speaks ONLY the versioned public wire format. Errors are
// surfaced as a status-carrying GateApiError keyed off the HTTP status — the
// backend's `error` string is NEVER propagated into CLI logs or state, only the
// public status code is, so no Cloud-internal message can leak.

import type { FetchFn } from "./cloud_client.ts";
import { type Gate, type GateRequest, parseGate } from "./gate_contract.ts";

/** Typed error reasons the caller branches on. Derived from HTTP status only. */
export type GateErrorReason =
  | "unauthorized" // 401
  | "not_found" // 404
  | "conflict" // 409 — illegal transition
  | "invalid" // 422 — bad type/payload/answer
  | "transient"; // network / 5xx — retryable inside an await loop

export class GateApiError extends Error {
  constructor(public readonly status: number, public readonly reason: GateErrorReason) {
    // CLI-owned message; deliberately NOT the backend's error string (§ I).
    super(`gate request failed (${reason}, status ${status})`);
    this.name = "GateApiError";
  }
}

/** Map an HTTP status to a typed reason. 5xx and 0 (network) → transient. */
export function reasonForStatus(status: number): GateErrorReason {
  if (status === 401) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "invalid";
  return "transient"; // 5xx, 0, and anything else the loop may retry
}

export class GateClient {
  private readonly base: string;
  private readonly fetchFn: FetchFn;

  constructor(apiUrl: string, fetchFn: FetchFn = fetch) {
    this.base = `${apiUrl.replace(/\/+$/, "")}/api/v1`;
    this.fetchFn = fetchFn;
  }

  private async send(
    method: string,
    path: string,
    token: string,
    body?: unknown,
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await this.fetchFn(`${this.base}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      // Network failure — surface as transient (status 0) so an await loop retries.
      throw new GateApiError(0, "transient");
    }
    return { status: res.status, json: await readJson(res) };
  }

  /** POST /api/v1/gates — open a gate. 201 ⇒ the new `open` gate. */
  async open(token: string, req: GateRequest): Promise<Gate> {
    const { status, json } = await this.send("POST", "/gates", token, {
      projectKey: req.projectKey,
      type: req.type,
      title: req.title,
      payload: req.payload,
      ...(req.taskNumber !== undefined ? { taskNumber: req.taskNumber } : {}),
    });
    if (status !== 201 && status !== 200) throw new GateApiError(status, reasonForStatus(status));
    const gate = parseGate(json.gate);
    if (!gate) throw new GateApiError(status, "transient");
    return gate;
  }

  /**
   * GET /api/v1/gates?projectKey=&state= — find one gate by id. The await loop's
   * resolution probe. Returns null when the gate isn't on the page yet. Pages via
   * the contract's opaque cursor (D1/D2) until the id is found or the feed ends.
   */
  async get(token: string, projectKey: string, id: string): Promise<Gate | null> {
    let cursor: string | undefined;
    // Bound the paging so a huge backlog can't make a single probe unbounded.
    for (let page = 0; page < 50; page++) {
      const qs = new URLSearchParams({ projectKey });
      if (cursor) qs.set("cursor", cursor);
      const { status, json } = await this.send("GET", `/gates?${qs.toString()}`, token);
      if (status !== 200) throw new GateApiError(status, reasonForStatus(status));
      const raw = Array.isArray(json.gates) ? json.gates : [];
      for (const r of raw) {
        const gate = parseGate(r);
        if (gate && gate.id === id) return gate;
      }
      const next = typeof json.cursor === "string" ? json.cursor : "";
      const hasMore = json.hasMore === true;
      if (!hasMore || next === "" || next === cursor) break;
      cursor = next;
    }
    return null;
  }

  /**
   * POST /api/v1/gates/{id}/apply — acknowledge consumption (answered → applied).
   * Idempotent: a 200 OR a 409 whose gate is already terminal `applied` is success.
   * `projectKey` lets us re-read the gate to confirm the terminal state on a 409,
   * rather than trusting an opaque conflict blindly.
   */
  async apply(token: string, projectKey: string, id: string): Promise<Gate> {
    const { status, json } = await this.send(
      "POST",
      `/gates/${encodeURIComponent(id)}/apply`,
      token,
    );
    if (status === 200) {
      const gate = parseGate(json.gate);
      if (gate) return gate;
      throw new GateApiError(status, "transient");
    }
    if (status === 409) {
      // The contract declares apply idempotent — confirm "already applied" by
      // reading the gate's terminal state; a 409 from any other cause is a real
      // conflict the caller must handle.
      const gate = await this.get(token, projectKey, id);
      if (gate && gate.state === "applied") return gate;
      throw new GateApiError(status, "conflict");
    }
    throw new GateApiError(status, reasonForStatus(status));
  }

  /** POST /api/v1/gates/{id}/cancel — withdraw an open gate (open → cancelled). */
  async cancel(token: string, id: string): Promise<Gate> {
    const { status, json } = await this.send(
      "POST",
      `/gates/${encodeURIComponent(id)}/cancel`,
      token,
    );
    if (status !== 200) throw new GateApiError(status, reasonForStatus(status));
    const gate = parseGate(json.gate);
    if (!gate) throw new GateApiError(status, "transient");
    return gate;
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}
