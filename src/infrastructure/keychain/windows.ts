// Windows keychain backend (#360) — Credential Manager via advapi32 + Deno FFI.
//
// CredWriteW / CredReadW / CredDeleteW operate on an in-memory CREDENTIALW
// struct; the secret lives in the CredentialBlob field — never an argv (FR-002).
// The `cmdkey` CLI is avoided (its `/pass:` form would expose the value on argv).
//
// Untestable in CI (no Windows host); every operation is wrapped so any FFI
// fault reports `unavailable`, degrading safely to the file store (FR-003).

import {
  KEYCHAIN_SERVICE,
  type KeychainBackend,
  type KeychainOutcome,
} from "./keychain_backend.ts";

const CRED_TYPE_GENERIC = 1;
const CRED_PERSIST_LOCAL_MACHINE = 2;
const ERROR_NOT_FOUND = 1168;

/** UTF-16LE, null-terminated, ArrayBuffer-backed (FFI buffer params require it). */
function wstr(s: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array((s.length + 1) * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < s.length; i++) view.setUint16(i * 2, s.charCodeAt(i), true);
  return out; // last 2 bytes already 0 (NUL)
}

/** UTF-8 bytes, ArrayBuffer-backed. */
function u8(s: string): Uint8Array<ArrayBuffer> {
  const e = new TextEncoder().encode(s);
  const out = new Uint8Array(e.length);
  out.set(e);
  return out;
}

// CREDENTIALW field offsets (x64, see windows.ts header note): Type@8,
// TargetName@16, CredentialBlobSize@40, CredentialBlob@48, Persist@56.
const CRED_SIZE = 88;
const OFF_TYPE = 8;
const OFF_TARGET = 16;
const OFF_BLOB_SIZE = 40;
const OFF_BLOB = 48;
const OFF_PERSIST = 56;

class WindowsCredentialBackend implements KeychainBackend {
  readonly platform = "windows" as const;

  constructor(
    private readonly advapi: AdvapiSymbols,
    private readonly kernel: KernelSymbols,
  ) {}

  private target(service: string, account: string): string {
    return `${service}:${account}`;
  }

  get(service: string, account: string): KeychainOutcome<string> {
    try {
      const name = wstr(this.target(service, account));
      const out = new BigUint64Array(1);
      const ok = this.advapi.symbols.CredReadW(name, CRED_TYPE_GENERIC, 0, out);
      if (!ok) {
        return this.kernel.symbols.GetLastError() === ERROR_NOT_FOUND
          ? { kind: "miss" }
          : { kind: "unavailable" };
      }
      const credPtr = Deno.UnsafePointer.create(out[0]);
      if (!credPtr) return { kind: "unavailable" };
      try {
        const v = new Deno.UnsafePointerView(credPtr);
        const size = v.getUint32(OFF_BLOB_SIZE);
        const blobPtr = Deno.UnsafePointer.create(v.getBigUint64(OFF_BLOB));
        if (!blobPtr || size === 0) return { kind: "ok", value: "" };
        const bytes = new Deno.UnsafePointerView(blobPtr).getArrayBuffer(size);
        return { kind: "ok", value: new TextDecoder().decode(bytes) };
      } finally {
        this.advapi.symbols.CredFree(credPtr);
      }
    } catch {
      return { kind: "unavailable" };
    }
  }

  set(service: string, account: string, secret: string): KeychainOutcome<void> {
    try {
      const name = wstr(this.target(service, account));
      const blob = u8(secret);
      const cred = new Uint8Array(CRED_SIZE);
      const view = new DataView(cred.buffer);
      view.setUint32(OFF_TYPE, CRED_TYPE_GENERIC, true);
      view.setBigUint64(OFF_TARGET, ptrVal(Deno.UnsafePointer.of(name)), true);
      view.setUint32(OFF_BLOB_SIZE, blob.length, true);
      view.setBigUint64(OFF_BLOB, ptrVal(Deno.UnsafePointer.of(blob)), true);
      view.setUint32(OFF_PERSIST, CRED_PERSIST_LOCAL_MACHINE, true);
      const ok = this.advapi.symbols.CredWriteW(cred, 0);
      return ok ? { kind: "ok", value: undefined } : { kind: "unavailable" };
    } catch {
      return { kind: "unavailable" };
    }
  }

  remove(service: string, account: string): KeychainOutcome<void> {
    try {
      const name = wstr(this.target(service, account));
      const ok = this.advapi.symbols.CredDeleteW(name, CRED_TYPE_GENERIC, 0);
      if (ok) return { kind: "ok", value: undefined };
      // Absent target ⇒ idempotent success; any other failure ⇒ unavailable.
      return this.kernel.symbols.GetLastError() === ERROR_NOT_FOUND
        ? { kind: "ok", value: undefined }
        : { kind: "unavailable" };
    } catch {
      return { kind: "unavailable" };
    }
  }

  reachable(): boolean {
    const probe = this.get(KEYCHAIN_SERVICE, "__probe__");
    return probe.kind !== "unavailable";
  }
}

function ptrVal(p: Deno.PointerValue): bigint {
  return BigInt(Deno.UnsafePointer.value(p));
}

type AdvapiSymbols = Deno.DynamicLibrary<{
  CredWriteW: { parameters: ["buffer", "u32"]; result: "i32" };
  CredReadW: { parameters: ["buffer", "u32", "u32", "buffer"]; result: "i32" };
  CredDeleteW: { parameters: ["buffer", "u32", "u32"]; result: "i32" };
  CredFree: { parameters: ["pointer"]; result: "void" };
}>;

type KernelSymbols = Deno.DynamicLibrary<{
  GetLastError: { parameters: []; result: "u32" };
}>;

/** Open the Windows backend. Throws if advapi32/kernel32 are unavailable or FFI
 *  is denied; select.ts treats any throw as "no keyring". */
export function openWindowsBackend(): KeychainBackend {
  const advapi = Deno.dlopen("advapi32.dll", {
    CredWriteW: { parameters: ["buffer", "u32"], result: "i32" },
    CredReadW: { parameters: ["buffer", "u32", "u32", "buffer"], result: "i32" },
    CredDeleteW: { parameters: ["buffer", "u32", "u32"], result: "i32" },
    CredFree: { parameters: ["pointer"], result: "void" },
  });
  const kernel = Deno.dlopen("kernel32.dll", {
    GetLastError: { parameters: [], result: "u32" },
  });
  return new WindowsCredentialBackend(advapi, kernel);
}
