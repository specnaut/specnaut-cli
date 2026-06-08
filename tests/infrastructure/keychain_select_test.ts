import { assertEquals } from "@std/assert";
import {
  backendFactoryFor,
  resolveCredentialStore,
} from "../../src/infrastructure/keychain/select.ts";
import type {
  KeychainBackend,
  KeychainOutcome,
} from "../../src/infrastructure/keychain/keychain_backend.ts";

function fakeBackend(reachable: boolean): KeychainBackend {
  const miss = (): KeychainOutcome<never> => ({ kind: "miss" });
  return {
    platform: "linux",
    get: miss,
    set: () => ({ kind: "ok", value: undefined }),
    remove: () => ({ kind: "ok", value: undefined }),
    reachable: () => reachable,
  };
}

Deno.test("resolveCredentialStore: reachable keyring → keychain store", () => {
  const store = resolveCredentialStore({ factory: () => fakeBackend(true) });
  assertEquals(store.kind, "keychain");
});

Deno.test("resolveCredentialStore: unreachable keyring → file store", () => {
  const store = resolveCredentialStore({ factory: () => fakeBackend(false) });
  assertEquals(store.kind, "file");
});

Deno.test("resolveCredentialStore: FFI permission denied → file store", () => {
  const store = resolveCredentialStore({
    factory: () => {
      throw new Deno.errors.PermissionDenied("requires allow-ffi");
    },
  });
  assertEquals(store.kind, "file");
});

Deno.test("resolveCredentialStore: missing library → file store", () => {
  const store = resolveCredentialStore({
    factory: () => {
      throw new Error("could not open dynamic library");
    },
  });
  assertEquals(store.kind, "file");
});

Deno.test("resolveCredentialStore: no native backend for the OS → file store", () => {
  const store = resolveCredentialStore({ factory: null });
  assertEquals(store.kind, "file");
});

Deno.test("backendFactoryFor: known OSes have a factory, others do not", () => {
  assertEquals(typeof backendFactoryFor("darwin"), "function");
  assertEquals(typeof backendFactoryFor("linux"), "function");
  assertEquals(typeof backendFactoryFor("windows"), "function");
  // deno-lint-ignore no-explicit-any -- exercise the unsupported-OS branch
  assertEquals(backendFactoryFor("freebsd" as any), null);
});
