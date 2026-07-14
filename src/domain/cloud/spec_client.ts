// HTTP client for the public spec endpoints (spec 020, consuming Lot 1's shipped
// `/api/v1/specs*`). A sibling of GateClient / CloudClient: same `{base}/api/v1`
// surface, same injectable `FetchFn`, same `Authorization: Bearer` scheme.
//
// Constitution § I: this speaks ONLY the versioned public wire format. Errors are
// surfaced as a status-carrying SpecApiError keyed off the HTTP status — the
// backend's `error` string is NEVER propagated into CLI logs or state, only the
// public status code is, so no Cloud-internal message can leak.

import type { FetchFn } from "./cloud_client.ts";
import { parseSpec, type SpecWire } from "./spec_contract.ts";
import type { SpecStep } from "../spec/spec_step.ts";

/** Typed error reasons the caller branches on. Derived from HTTP status only. */
export type SpecErrorReason =
  | "unauthorized" // 401
  | "not_found" // 404
  | "conflict" // 409
  | "invalid" // 422 — bad payload
  | "transient"; // network / 5xx — retryable

export class SpecApiError extends Error {
  constructor(public readonly status: number, public readonly reason: SpecErrorReason) {
    // CLI-owned message; deliberately NOT the backend's error string (§ I).
    super(`spec request failed (${reason}, status ${status})`);
    this.name = "SpecApiError";
  }
}

/** Map an HTTP status to a typed reason. 5xx and 0 (network) → transient. */
export function reasonForStatus(status: number): SpecErrorReason {
  if (status === 401) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "invalid";
  return "transient"; // 5xx, 0, and anything else
}

export class SpecClient {
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
      // Network failure — surface as transient (status 0) so callers can retry.
      throw new SpecApiError(0, "transient");
    }
    return { status: res.status, json: await readJson(res) };
  }

  /**
   * POST /api/v1/specs — ensure a spec exists for a task and attach it,
   * idempotently. Returns the (possibly newly-created) spec.
   */
  async ensure(
    token: string,
    projectKey: string,
    taskNumber: number,
    title?: string,
  ): Promise<SpecWire> {
    const { status, json } = await this.send("POST", "/specs", token, {
      projectKey,
      taskNumber,
      ...(title !== undefined ? { title } : {}),
    });
    if (status !== 201 && status !== 200) throw new SpecApiError(status, reasonForStatus(status));
    const spec = parseSpec(json.spec);
    if (!spec) throw new SpecApiError(status, "transient");
    return spec;
  }

  /**
   * GET /api/v1/specs?projectKey=&taskNumber= — pull a task's spec. Returns
   * null when the task has no spec yet (a `null` body or a 404), which the
   * caller treats as "nothing to materialise", not an error.
   */
  async get(token: string, projectKey: string, taskNumber: number): Promise<SpecWire | null> {
    const qs = new URLSearchParams({ projectKey, taskNumber: String(taskNumber) });
    const { status, json } = await this.send("GET", `/specs?${qs.toString()}`, token);
    if (status === 404) return null;
    if (status !== 200) throw new SpecApiError(status, reasonForStatus(status));
    if (json.spec === null || json.spec === undefined) return null;
    return parseSpec(json.spec);
  }

  /**
   * PUT /api/v1/specs/steps — upsert-only push of a task's steps. Never deletes
   * an omitted step (Lot 1 FR-011); only the sent steps are created/updated.
   */
  async putSteps(
    token: string,
    projectKey: string,
    taskNumber: number,
    steps: readonly SpecStep[],
  ): Promise<void> {
    const { status } = await this.send("PUT", "/specs/steps", token, {
      projectKey,
      taskNumber,
      steps: steps.map((s) => ({ key: s.key, name: s.name, order: s.order, body: s.body })),
    });
    if (status !== 200 && status !== 201) throw new SpecApiError(status, reasonForStatus(status));
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}
