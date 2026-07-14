// Spec session orchestration (spec 020): the compiled surface the spec push /
// pull commands and cloud-mode `specify` drive. Mirrors gate_session.ts — all IO
// is injected (the SpecClient, a CloudClient for task auto-creation, and a token
// provider with transparent refresh) so the whole thing is unit-testable with a
// fake fetch and no network / keychain.
//
// Constitution § I: only the opaque SpecStep{key,name,order,body} and the public
// projectKey / taskNumber cross the wire. Errors are CLI-owned SpecApiErrors
// keyed off HTTP status — never a Cloud-internal identifier or backend string.

import { SpecApiError, SpecClient } from "./spec_client.ts";
import { CloudClient, type FetchFn } from "./cloud_client.ts";
import { freshAccessToken } from "./auth_flow.ts";
import type { CloudConfig } from "./cloud_config.ts";
import type { CredentialStore } from "../../infrastructure/credential_store.ts";
import type { SpecStep } from "../spec/spec_step.ts";

/** A valid bearer token, or null when the user must re-authenticate. */
export type TokenProvider = () => Promise<string | null>;

export type SpecSessionDeps = {
  projectKey: string;
  client: SpecClient;
  cloudClient: CloudClient;
  token: TokenProvider;
};

/** Outcome of authoring a spec to the cloud (cloud-mode `specify`). */
export type AuthorResult = {
  /** The task the spec is attached to — created here when none was linked. */
  taskNumber: number;
  /** Number of steps pushed. */
  pushed: number;
  /** True when the task was auto-created because none was linked (FR-011). */
  created: boolean;
};

export class SpecSession {
  constructor(private readonly deps: SpecSessionDeps) {}

  get projectKey(): string {
    return this.deps.projectKey;
  }

  /** Obtain a bearer token or fail with a typed unauthorized error (→ re-login). */
  private async requireToken(): Promise<string> {
    const tok = await this.deps.token();
    if (!tok) throw new SpecApiError(401, "unauthorized");
    return tok;
  }

  /** Pull a task's spec steps, or `null` when the task has no spec yet. */
  async pull(taskNumber: number): Promise<readonly SpecStep[] | null> {
    const tok = await this.requireToken();
    const spec = await this.deps.client.get(tok, this.deps.projectKey, taskNumber);
    return spec ? spec.steps : null;
  }

  /** Upsert-only push of a task's steps (never deletes an omitted step). */
  async push(taskNumber: number, steps: readonly SpecStep[]): Promise<void> {
    const tok = await this.requireToken();
    await this.deps.client.putSteps(tok, this.deps.projectKey, taskNumber, steps);
  }

  /** Ensure a spec exists for a task and attach it (idempotent). */
  async ensure(taskNumber: number, title?: string): Promise<void> {
    const tok = await this.requireToken();
    await this.deps.client.ensure(tok, this.deps.projectKey, taskNumber, title);
  }

  /** Auto-create a backlog task from a title and return its number (FR-011). */
  async createTask(title: string): Promise<number> {
    const tok = await this.requireToken();
    const task = await this.deps.cloudClient.createTask(tok, this.deps.projectKey, title);
    return task.number;
  }

  /**
   * Cloud-mode `specify` authoring: resolve the target task (auto-creating +
   * linking one from `title` when `taskNumber` is null — FR-011), ensure its
   * spec exists, then upsert the generated steps. Creates NO branch and touches
   * NO `.specnaut/specs/` files — those side effects live only on the local path
   * (the caller persists the returned `taskNumber` to link it).
   */
  async author(
    taskNumber: number | null,
    title: string,
    steps: readonly SpecStep[],
  ): Promise<AuthorResult> {
    let created = false;
    let resolved = taskNumber;
    if (resolved === null) {
      resolved = await this.createTask(title);
      created = true;
    }
    await this.ensure(resolved, title);
    await this.push(resolved, steps);
    return { taskNumber: resolved, pushed: steps.length, created };
  }
}

/**
 * One-call factory to obtain a ready SpecSession from the project's Cloud config
 * + credentials. Reuses the same Cloud-link file (`backlog-config.yml`) and
 * credential store the gate/backlog paths use — no new credential type (FR-007).
 * Returns `null` when the project isn't Cloud-linked (no api_url / project_key),
 * which the caller treats as "not a cloud-backed spec project". `fetchFn` / `now`
 * are injectable for tests. Mirrors {@link makeGateSession}.
 */
export function makeSpecSession(deps: {
  config: CloudConfig;
  store: CredentialStore;
  env?: (key: string) => string | undefined;
  fetchFn?: FetchFn;
  now?: () => number;
}): SpecSession | null {
  const { config, store } = deps;
  if (!config.apiUrl || !config.projectKey) return null;

  const env = deps.env ?? ((k) => Deno.env.get(k));
  const now = deps.now ?? (() => Date.now());
  const fetchFn = deps.fetchFn ?? fetch;

  const cloudClient = new CloudClient(config.apiUrl, fetchFn);
  const specClient = new SpecClient(config.apiUrl, fetchFn);

  // Headless escape hatch: an explicit SPECNAUT_CLOUD_TOKEN short-circuits the
  // stored-credential refresh path (mirroring gate_session). The legacy
  // SPECFLOW_CLOUD_TOKEN name is still honored as a fallback.
  const headlessToken = env("SPECNAUT_CLOUD_TOKEN") ?? env("SPECFLOW_CLOUD_TOKEN");
  const token: TokenProvider = headlessToken && headlessToken.trim() !== ""
    ? () => Promise.resolve(headlessToken)
    : () => freshAccessToken({ apiUrl: config.apiUrl, client: cloudClient, store, now });

  return new SpecSession({
    projectKey: config.projectKey,
    client: specClient,
    cloudClient,
    token,
  });
}
