// Thin client for the Specflow Cloud public HTTP API (#353). Consumes only the
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
    const res = await this.fetchFn(`${this.base}/projects`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = await readJson(res);
    if (res.status !== 200) {
      throw new CloudApiError(res.status, strField(json, "error") ?? "list projects failed");
    }
    const raw = Array.isArray(json.projects) ? json.projects : [];
    return raw.map((p) => {
      const o = p as Record<string, unknown>;
      return { key: String(o.key), name: String(o.name), role: String(o.role ?? "") };
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

/** Clamp a (possibly NaN) number into [lo, hi], falling back to lo. */
function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
