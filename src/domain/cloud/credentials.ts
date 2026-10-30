// The credential port the Cloud auth flow and sessions depend on (#353, cli#695).
//
// It lives in the domain, not beside its adapters: `auth_flow.ts`,
// `gate_session.ts` and `spec_session.ts` need the shape, and the domain may
// import nothing outward. The OS-keychain and `0600`-file implementations are in
// `infrastructure/credential_store.ts` and `infrastructure/keychain/`.

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
