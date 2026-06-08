// Per-invocation credential-store selection (#360).
//
// `resolveCredentialStore()` picks the OS-native keychain when a keyring is
// reachable, else the `0600` file store. The decision is made fresh each call
// (FR-004): a credential written on a desktop and synced to a headless box must
// not be served from a different store. The platform backend factory is
// injectable so the selection logic is unit-tested without any FFI.

import { type CredentialStore, FileCredentialStore } from "../credential_store.ts";
import { type KeychainBackend, KeychainCredentialStore } from "./keychain_backend.ts";
import { openMacosBackend } from "./macos.ts";
import { openLinuxBackend } from "./linux.ts";
import { openWindowsBackend } from "./windows.ts";

/** Opens a platform keychain backend. May throw (no `--allow-ffi`, missing lib). */
export type BackendFactory = () => KeychainBackend;

/** The native backend factory for an OS, or `null` where none is supported. */
export function backendFactoryFor(os: typeof Deno.build.os): BackendFactory | null {
  switch (os) {
    case "darwin":
      return openMacosBackend;
    case "linux":
      return openLinuxBackend;
    case "windows":
      return openWindowsBackend;
    default:
      return null;
  }
}

export interface ResolveOptions {
  /** Override the detected OS (tests). */
  os?: typeof Deno.build.os;
  /** Override the backend factory (tests). `null` forces the file store. */
  factory?: BackendFactory | null;
}

/**
 * Resolve the credential store for this invocation: native keychain if a
 * keyring is reachable, otherwise the `0600` file fallback. Never throws — any
 * FFI permission/availability failure degrades to the file store.
 */
export function resolveCredentialStore(opts: ResolveOptions = {}): CredentialStore {
  const os = opts.os ?? Deno.build.os;
  const factory = opts.factory !== undefined ? opts.factory : backendFactoryFor(os);
  if (!factory) return new FileCredentialStore();
  try {
    const backend = factory();
    if (backend.reachable()) return new KeychainCredentialStore(backend);
  } catch {
    // PermissionDenied (binary without --allow-ffi), missing library, or an
    // unsupported platform — fall back to the file store.
  }
  return new FileCredentialStore();
}
