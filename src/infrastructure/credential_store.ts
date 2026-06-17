// Secure storage for Specnaut Cloud CLI credentials (#353).
//
// The access token is short-lived and the refresh token is long-lived; both are
// secrets and must never land in a tracked file (the project's
// `.specflow/backlog-config.yml` holds only `backend`, `api_url`, `project_key`).
//
// Storage: two backends behind one interface.
//   - OS-native keychain (macOS Keychain / libsecret / Windows Credential
//     Manager), reached via Deno FFI — the preferred at-rest store when a
//     keyring is reachable (#360).
//   - `0600` home-dir JSON file, created inside a `0700` directory and written
//     atomically (temp + rename) so a secret is never visible through a
//     looser-permission window — the fallback for headless / CI / no-`--allow-ffi`.
// `defaultCredentialStore()` selects between them per invocation (see
// `keychain/select.ts`). Credentials are keyed by the Cloud deployment's API
// base URL, so one machine can hold tokens for several deployments.
//
// The keychain is NEVER reached via the `security` / `secret-tool` / `cmdkey`
// CLIs, whose secret-on-argv forms (`-w <secret>`, `store <value>`, `/pass:`)
// would expose the token to same-user `ps`; only the native in-process API is
// used.

import { resolveCredentialStore } from "./keychain/select.ts";

export type CloudCredentials = {
  /** Bearer access token sent on every `/api/v1` request. Short-lived. */
  accessToken: string;
  /** Long-lived credential exchanged at `/api/v1/auth/refresh`. */
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  accessExpiresAt: number;
};

export interface CredentialStore {
  /** Which backend secured the credentials — surfaced at login so the at-rest
   *  posture is never silently weaker than expected (#360). */
  readonly kind: "keychain" | "file";
  /** Load the credentials for a deployment, or null if none are stored. */
  load(apiUrl: string): Promise<CloudCredentials | null>;
  /** Persist (overwrite) the credentials for a deployment. */
  save(apiUrl: string, creds: CloudCredentials): Promise<void>;
  /** Remove the credentials for a deployment (no-op if absent). */
  delete(apiUrl: string): Promise<void>;
}

/** Resolve the user's home directory across platforms. */
function homeDir(): string {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  if (!home) throw new Error("cannot resolve home directory (HOME unset)");
  return home;
}

/** Normalize an API URL into a stable key (no trailing slash). Shared by the
 *  file and keychain stores so a credential is addressable identically in both. */
export function keyFor(apiUrl: string): string {
  return apiUrl.replace(/\/+$/, "");
}

/**
 * File-backed store: a single JSON object `{ [apiUrl]: creds }` at
 * `~/.specflow/credentials.json`, dir `0700`, file `0600`, written atomically.
 */
export class FileCredentialStore implements CredentialStore {
  readonly kind = "file" as const;
  private readonly path: string;

  constructor(path?: string) {
    this.path = path ?? `${homeDir()}/.specflow/credentials.json`;
  }

  private get dir(): string {
    return this.path.slice(0, this.path.lastIndexOf("/"));
  }

  private async readAll(): Promise<Record<string, CloudCredentials>> {
    try {
      const text = await Deno.readTextFile(this.path);
      const parsed = JSON.parse(text) as Record<string, CloudCredentials>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return {};
      // A corrupt file shouldn't wedge auth — treat it as empty.
      if (e instanceof SyntaxError) return {};
      throw e;
    }
  }

  private async writeAll(all: Record<string, CloudCredentials>): Promise<void> {
    await Deno.mkdir(this.dir, { recursive: true, mode: 0o700 });
    // Tighten the dir even if it pre-existed with looser perms (no-op on Windows).
    try {
      await Deno.chmod(this.dir, 0o700);
    } catch { /* unsupported FS / Windows */ }

    // Atomic publish: write a 0600 temp file in the same dir, then rename over
    // the target. No window where the secret sits under looser perms.
    const tmp = `${this.path}.${Math.abs(hash(JSON.stringify(all)))}.tmp`;
    await Deno.writeTextFile(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
    try {
      await Deno.chmod(tmp, 0o600);
    } catch { /* Windows */ }
    await Deno.rename(tmp, this.path);
  }

  async load(apiUrl: string): Promise<CloudCredentials | null> {
    const all = await this.readAll();
    return all[keyFor(apiUrl)] ?? null;
  }

  async save(apiUrl: string, creds: CloudCredentials): Promise<void> {
    const all = await this.readAll();
    all[keyFor(apiUrl)] = creds;
    await this.writeAll(all);
  }

  async delete(apiUrl: string): Promise<void> {
    const all = await this.readAll();
    if (delete all[keyFor(apiUrl)]) await this.writeAll(all);
  }
}

/** Small non-crypto hash for a unique-enough temp suffix (single writer). */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * The credential store for the current platform and invocation: the OS-native
 * keychain when a keyring is reachable, else the `0600` home file (headless /
 * CI / no `--allow-ffi`). Selection happens per call — see
 * `keychain/select.ts`. The keychain `dlopen`/probe is synchronous, so this
 * stays a synchronous factory (call sites are unchanged from #353).
 */
export function defaultCredentialStore(): CredentialStore {
  return resolveCredentialStore();
}
