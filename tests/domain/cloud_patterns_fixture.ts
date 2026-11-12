import { bundledCredentialPatterns } from "../../src/application/credential_patterns.ts";

/** What a test of a client that writes to Cloud needs: the patterns it is handed, and its types. */
export type { CloudClient, FetchFn } from "../../src/domain/cloud/cloud_client.ts";

/** The credential patterns this build carries: what a client that writes is handed. */
export const PATTERNS = bundledCredentialPatterns();
