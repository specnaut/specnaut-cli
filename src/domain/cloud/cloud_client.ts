// Thin client for the Specnaut Cloud public HTTP API (#353). Consumes only the
// documented, versioned `/api/v1` wire format — the sole OSS↔Cloud coupling.
// `fetch` is injectable for tests.

import {
  clamp,
  cleanText,
  cloudFetch,
  isRedirectStatus,
  isUnavailableStatus,
  readJson,
  REDIRECT_REFUSED,
  strField,
} from "./cloud_wire.ts";
import { tokenPair } from "./token_pair.ts";
import { type CredentialPatterns, refuseCredentials } from "./credential_check.ts";

export type DeviceStart = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresInS: number;
  intervalS: number;
};

export type TokenPoll =
  | { status: "pending" | "slow_down" | "denied" | "expired" | "invalid" }
  | {
    status: "approved";
    accessToken: string;
    refreshToken: string;
    expiresInS: number;
  };

export type RefreshResult =
  | { status: "ok"; accessToken: string; refreshToken: string; expiresInS: number }
  | { status: "invalid" | "expired" };

export type CloudProject = { key: string; name: string; role: string };

/** An org the authenticated account belongs to (`GET /api/v1/orgs`, #398).
 *  Identified by its public `slug`; `isActive` marks the org the current
 *  session/token is bound to. */
export type CloudOrg = {
  slug: string;
  name: string;
  role: string;
  isActive: boolean;
};

export type CloudColumn = { id: string; name: string; order: number };

export type CloudTask = {
  number: number;
  title: string;
  columnId: string;
  priority: string | null;
  size: string | null;
};

export type FetchFn = typeof fetch;

export class CloudApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "CloudApiError";
  }
}

/** An error saying Cloud is unavailable, as opposed to an answer it gave. */
export function isUnavailable(e: unknown): boolean {
  return e instanceof CloudApiError && isUnavailableStatus(e.status);
}

/** A redirect Cloud answered with: no client follows one (cloud_wire.ts). */
export function isRedirected(e: unknown): e is CloudApiError {
  return e instanceof CloudApiError && isRedirectStatus(e.status);
}

export class CloudClient {
  private readonly base: string;
  private readonly fetchFn: FetchFn;

  /** `patterns` checks the text a create sends; with none, a create sends nothing. */
  constructor(
    apiUrl: string,
    fetchFn: FetchFn = fetch,
    private readonly patterns?: CredentialPatterns,
    /** The tokens the session holds beyond the one a call is given: none a field may carry. */
    private readonly held: () => readonly string[] = () => [],
  ) {
    this.base = `${apiUrl.replace(/\/+$/, "")}/api/v1`;
    this.fetchFn = fetchFn;
  }

  /** One request: a network failure, mid-body too, or a redirect is a CloudApiError. */
  private async send(
    path: string,
    init: RequestInit,
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    try {
      const res = await cloudFetch(this.fetchFn, `${this.base}${path}`, init);
      if (isRedirectStatus(res.status)) {
        await res.body?.cancel();
        throw new CloudApiError(res.status, REDIRECT_REFUSED);
      }
      return { status: res.status, json: await readJson(res) };
    } catch (e) {
      if (e instanceof TypeError) throw new CloudApiError(0, "Specnaut Cloud cannot be reached");
      throw e;
    }
  }

  private postJson(
    path: string,
    body: unknown,
    accessToken?: string,
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return this.send(path, { method: "POST", headers, body: JSON.stringify(body ?? {}) });
  }

  /** Authenticated GET → parsed body, throwing CloudApiError on non-200. The
   *  bearer token only ever travels in the Authorization header (never logged,
   *  never in the URL/querystring). */
  private async getJson(
    path: string,
    accessToken: string,
    failMsg: string,
  ): Promise<Record<string, unknown>> {
    const { status, json } = await this.send(path, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (status !== 200) {
      throw new CloudApiError(status, strField(json, "error") ?? failMsg);
    }
    return json;
  }

  // `specflow-cli` is the frozen OAuth device-client id the Cloud backend
  // matches on — intentionally NOT renamed in the specflow→specnaut rebrand
  // (renaming it breaks the device-grant flow for already-released CLI builds).
  async startDevice(client = "specflow-cli"): Promise<DeviceStart> {
    const { status, json } = await this.postJson("/auth/device", { client });
    if (status !== 200) {
      throw new CloudApiError(status, strField(json, "error") ?? "device start failed");
    }
    return {
      deviceCode: String(json.device_code),
      userCode: cleanText(json.user_code),
      verificationUri: cleanText(json.verification_uri),
      verificationUriComplete: cleanText(
        json.verification_uri_complete ?? json.verification_uri,
      ),
      // Clamp server-controlled timing so a malicious/misconfigured server can't
      // induce a tight poll loop (interval floor) or a multi-day session (expiry
      // ceiling). RFC 8628 recommends a 5s minimum poll interval.
      expiresInS: clamp(Number(json.expires_in ?? 900), 60, 1800),
      intervalS: clamp(Number(json.interval ?? 5), 5, 60),
    };
  }

  async pollToken(deviceCode: string): Promise<TokenPoll> {
    const { json } = await this.postJson("/auth/token", { device_code: deviceCode });
    const s = typeof json.status === "string" ? json.status : "invalid";
    const pair = tokenPair(json);
    if (s === "approved") return pair ? { status: "approved", ...pair } : { status: "invalid" };
    if (s === "pending" || s === "slow_down" || s === "denied" || s === "expired") {
      return { status: s };
    }
    return { status: "invalid" };
  }

  /** Rotate the pair. Only a literal `expired` / `invalid` condemns the token. Cloud unreachable,
   *  failing (5xx), redirecting, or any other answer (a 429, a proxy's page) throws: no
   *  verdict, so the token survives for the next attempt. */
  async refresh(refreshToken: string): Promise<RefreshResult> {
    const { status, json } = await this.postJson("/auth/refresh", { refresh_token: refreshToken });
    if (isUnavailableStatus(status)) {
      throw new CloudApiError(status, "token refresh: Cloud unavailable");
    }
    const verdict = typeof json.status === "string" ? json.status : "";
    const pair = tokenPair(json);
    if (verdict === "ok" && pair) return { status: "ok", ...pair };
    if (verdict === "expired" || verdict === "invalid") return { status: verdict };
    throw new CloudApiError(status, "token refresh: no verdict on the token");
  }

  async listProjects(accessToken: string): Promise<CloudProject[]> {
    const json = await this.getJson("/projects", accessToken, "list projects failed");
    return listOf(json, "projects").map((o) => ({
      key: cleanText(o.key),
      name: cleanText(o.name),
      role: cleanText(o.role),
    }));
  }

  /** The orgs the authenticated account belongs to (`specnaut cloud orgs`). */
  async listOrgs(accessToken: string): Promise<CloudOrg[]> {
    const json = await this.getJson("/orgs", accessToken, "list orgs failed");
    return listOf(json, "orgs").map((r) => ({
      slug: cleanText(r.slug),
      name: cleanText(r.name),
      role: cleanText(r.role),
      isActive: Boolean(r.isActive),
    }));
  }

  /** The board's columns for a project (`specnaut cloud board`). */
  async listColumns(accessToken: string, projectKey: string): Promise<CloudColumn[]> {
    const json = await this.getJson(
      `/columns?projectKey=${encodeURIComponent(projectKey)}`,
      accessToken,
      "list columns failed",
    );
    return listOf(json, "columns").map((o) => ({
      id: String(o.id),
      name: cleanText(o.name),
      order: Number(o.order ?? 0),
    }));
  }

  /** The project's tasks (`specnaut cloud board`). */
  async listTasks(accessToken: string, projectKey: string): Promise<CloudTask[]> {
    const json = await this.getJson(
      `/tasks?projectKey=${encodeURIComponent(projectKey)}`,
      accessToken,
      "list tasks failed",
    );
    return listOf(json, "tasks").map((o) => taskOf(o));
  }

  async createProject(
    accessToken: string,
    key: string,
    name: string,
  ): Promise<CloudProject> {
    const fields = [["project key", key], ["project name", name]] as const;
    refuseCredentials(this.patterns, fields, [accessToken, ...this.held()]);
    const { status, json } = await this.postJson("/projects", { key, name }, accessToken);
    if (status !== 201 && status !== 200) {
      throw new CloudApiError(status, strField(json, "error") ?? "create project failed");
    }
    const p = (json.project ?? {}) as Record<string, unknown>;
    return { key: cleanText(p.key ?? key), name: cleanText(p.name ?? name), role: "owner" };
  }

  /**
   * Create a backlog task on a project's board (`POST /api/v1/tasks`, the
   * shipped endpoint the `add.sh` script also uses). Returns the new task's
   * public number — used by cloud-mode `specify` to auto-create + link a task
   * when the authoring flow runs with none linked (spec 020, FR-011). Kept as a
   * typed compiled call (not the backend-gated bash `add.sh`) so auto-creation
   * is independent of which backlog backend is configured.
   */
  async createTask(
    accessToken: string,
    projectKey: string,
    title: string,
  ): Promise<CloudTask> {
    refuseCredentials(this.patterns, [["task title", title]], [accessToken, ...this.held()]);
    const { status, json } = await this.postJson("/tasks", { projectKey, title }, accessToken);
    if (status !== 201 && status !== 200) {
      throw new CloudApiError(status, strField(json, "error") ?? "create task failed");
    }
    return taskOf((json.task ?? {}) as Record<string, unknown>, title);
  }
}

/** A list field of a body, each element read as an object; anything else is an empty list. */
function listOf(json: Record<string, unknown>, field: string): Record<string, unknown>[] {
  const raw = json[field];
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
}

/** A task from its wire object; `title` stands in when the answer carries none. */
function taskOf(o: Record<string, unknown>, title?: string): CloudTask {
  return {
    number: Number(o.number ?? 0),
    title: cleanText(o.title ?? title),
    columnId: String(o.columnId ?? ""),
    priority: strField(o, "priority"),
    size: strField(o, "size"),
  };
}
