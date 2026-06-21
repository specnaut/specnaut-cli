// Thin client for the Specnaut Cloud public HTTP API (#353). Consumes only the
// documented, versioned `/api/v1` wire format — the sole OSS↔Cloud coupling.
// `fetch` is injectable for tests.

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

export class CloudClient {
  private readonly base: string;
  private readonly fetchFn: FetchFn;

  constructor(apiUrl: string, fetchFn: FetchFn = fetch) {
    this.base = `${apiUrl.replace(/\/+$/, "")}/api/v1`;
    this.fetchFn = fetchFn;
  }

  private async postJson(
    path: string,
    body: unknown,
    accessToken?: string,
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const res = await this.fetchFn(`${this.base}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
    });
    return { status: res.status, json: await readJson(res) };
  }

  /** Authenticated GET → parsed body, throwing CloudApiError on non-200. The
   *  bearer token only ever travels in the Authorization header (never logged,
   *  never in the URL/querystring). */
  private async getJson(
    path: string,
    accessToken: string,
    failMsg: string,
  ): Promise<Record<string, unknown>> {
    const res = await this.fetchFn(`${this.base}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = await readJson(res);
    if (res.status !== 200) {
      throw new CloudApiError(res.status, strField(json, "error") ?? failMsg);
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
      userCode: String(json.user_code),
      verificationUri: String(json.verification_uri),
      verificationUriComplete: String(
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
    const s = String(json.status ?? "invalid");
    if (s === "approved") {
      return {
        status: "approved",
        accessToken: String(json.access_token),
        refreshToken: String(json.refresh_token),
        expiresInS: Number(json.expires_in ?? 0),
      };
    }
    if (s === "pending" || s === "slow_down" || s === "denied" || s === "expired") {
      return { status: s };
    }
    return { status: "invalid" };
  }

  async refresh(refreshToken: string): Promise<RefreshResult> {
    const { json } = await this.postJson("/auth/refresh", {
      refresh_token: refreshToken,
    });
    if (String(json.status) === "ok") {
      return {
        status: "ok",
        accessToken: String(json.access_token),
        refreshToken: String(json.refresh_token),
        expiresInS: Number(json.expires_in ?? 0),
      };
    }
    return { status: String(json.status) === "expired" ? "expired" : "invalid" };
  }

  async listProjects(accessToken: string): Promise<CloudProject[]> {
    const json = await this.getJson("/projects", accessToken, "list projects failed");
    const raw = Array.isArray(json.projects) ? json.projects : [];
    return raw.map((p) => {
      const o = p as Record<string, unknown>;
      return { key: String(o.key), name: String(o.name), role: String(o.role ?? "") };
    });
  }

  /** The orgs the authenticated account belongs to (`specnaut cloud orgs`). */
  async listOrgs(accessToken: string): Promise<CloudOrg[]> {
    const json = await this.getJson("/orgs", accessToken, "list orgs failed");
    const raw = Array.isArray(json.orgs) ? json.orgs : [];
    return raw.map((o) => {
      const r = o as Record<string, unknown>;
      return {
        slug: cleanText(r.slug),
        name: cleanText(r.name),
        role: cleanText(r.role),
        isActive: Boolean(r.isActive),
      };
    });
  }

  /** The board's columns for a project (`specnaut cloud board`). */
  async listColumns(accessToken: string, projectKey: string): Promise<CloudColumn[]> {
    const json = await this.getJson(
      `/columns?projectKey=${encodeURIComponent(projectKey)}`,
      accessToken,
      "list columns failed",
    );
    const raw = Array.isArray(json.columns) ? json.columns : [];
    return raw.map((c) => {
      const o = c as Record<string, unknown>;
      return { id: String(o.id), name: cleanText(o.name), order: Number(o.order ?? 0) };
    });
  }

  /** The project's tasks (`specnaut cloud board`). */
  async listTasks(accessToken: string, projectKey: string): Promise<CloudTask[]> {
    const json = await this.getJson(
      `/tasks?projectKey=${encodeURIComponent(projectKey)}`,
      accessToken,
      "list tasks failed",
    );
    const raw = Array.isArray(json.tasks) ? json.tasks : [];
    return raw.map((t) => {
      const o = t as Record<string, unknown>;
      return {
        number: Number(o.number ?? 0),
        title: cleanText(o.title),
        columnId: String(o.columnId ?? ""),
        priority: typeof o.priority === "string" ? o.priority : null,
        size: typeof o.size === "string" ? o.size : null,
      };
    });
  }

  async createProject(
    accessToken: string,
    key: string,
    name: string,
  ): Promise<CloudProject> {
    const { status, json } = await this.postJson("/projects", { key, name }, accessToken);
    if (status !== 201 && status !== 200) {
      throw new CloudApiError(status, strField(json, "error") ?? "create project failed");
    }
    const p = (json.project ?? {}) as Record<string, unknown>;
    return { key: String(p.key ?? key), name: String(p.name ?? name), role: "owner" };
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function strField(json: Record<string, unknown>, key: string): string | null {
  const v = json[key];
  return typeof v === "string" ? v : null;
}

/** Coerce a server value to a string with control / non-printable characters
 *  stripped, so hostile or misconfigured API output can't inject terminal
 *  escape sequences (ANSI / OSC) when the CLI prints org names, board column
 *  names, or task titles (#398 hardening). */
function cleanText(v: unknown): string {
  // deno-lint-ignore no-control-regex
  return String(v ?? "").replace(/[\x00-\x1f\x7f]/g, "");
}

/** Clamp a (possibly NaN) number into [lo, hi], falling back to lo. */
function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
