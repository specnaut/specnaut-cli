// Spec session orchestration (spec 020): the compiled surface the spec push /
// pull commands and cloud-mode `specify` drive. Mirrors gate_session.ts — all IO
// is injected (the SpecClient, a CloudClient for task auto-creation, and a token
// provider with transparent refresh) so the whole thing is unit-testable with a
// fake fetch and no network / keychain.
//
// Constitution § I: only the opaque SpecStep{key,name,order,body} and the public
// projectKey / taskNumber cross the wire. Errors are CLI-owned SpecApiErrors
// keyed off HTTP status — never a Cloud-internal identifier or backend string.

import { SpecApiError, SpecClient, stepFields } from "./spec_client.ts";
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

  /**
   * Obtain a bearer token or fail with a typed unauthorized error (→ re-login).
   * A refresh that cannot reach Cloud is transient, like any other network failure; one
   * that meets a redirect is that, not an outage.
   */
  private async requireToken(): Promise<string> {
    let tok: string | null;
    try {
      tok = await this.deps.token();
    } catch (e) {
      if (isUnavailable(e)) throw new SpecApiError(0, "transient");
      if (isRedirected(e)) throw new SpecApiError(e.status, "redirected");
      if (e instanceof CloudApiError) throw new SpecApiError(e.status, "unexpected");
      throw e;
    }
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
    // Everything this sends is checked before its first request: a refusal at the push
    // would leave a task created and a spec attached that nobody asked for.
    const what = taskNumber === null ? "task title" : "spec title";
    this.deps.client.refuse(await this.requireToken(), [[what, title], ...stepFields(steps)]);
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
 * which the caller treats as "not a cloud-backed spec project"; an api_url that is
 * set and not plain throws InvalidApiUrl. `env` is supplied
 * by the caller; `fetchFn` / `now` are injectable for tests. Mirrors
 * {@link makeGateSession}.
 */
export function makeSpecSession(deps: {
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
}): SpecSession | null {
  const { config, env } = deps;
  const { store, held } = watchedStore(deps.store);
  const apiUrl = linkedApiUrl(config.apiUrl);
  if (!apiUrl || !config.projectKey) return null;

  const now = deps.now ?? (() => Date.now());
  const fetchFn = deps.fetchFn ?? fetch;

  const cloudClient = new CloudClient(apiUrl, fetchFn, deps.patterns, held);
  const specClient = new SpecClient(apiUrl, fetchFn, deps.patterns, held);

  // SPECNAUT_CLOUD_TOKEN, for a deployment it may go to only; else the stored login.
  const stored = () => accessToken({ apiUrl, client: cloudClient, store, now });
  const token: TokenProvider = sessionToken(apiUrl, env, stored, deps.warn);

  return new SpecSession({
    projectKey: config.projectKey,
    client: specClient,
    cloudClient,
    token,
  });
}
