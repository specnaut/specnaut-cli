// macOS keychain backend (#360) — Security.framework via Deno FFI.
//
// Uses the legacy generic-password API (SecKeychainAddGenericPassword &c.)
// rather than the modern SecItem* / CoreFoundation surface: it takes plain C
// buffers (length + pointer), so the FFI surface is ~5 primitive-signature
// symbols and the secret is passed as an in-process byte-buffer pointer — never
// an argv (FR-002). The API is deprecated-but-stable; the file fallback backs
// every platform, so the deprecation risk is bounded.
//
// Short-lived CLI process: SecKeychainItemRef handles returned by Find are not
// CFReleased (no CoreFoundation pulled in); the OS reclaims them at process
// exit. Password buffers ARE freed via SecKeychainItemFreeContent.

import {
  KEYCHAIN_SERVICE,
  type KeychainBackend,
  type KeychainOutcome,
} from "./keychain_backend.ts";

const SECURITY_PATH = "/System/Library/Frameworks/Security.framework/Versions/A/Security";

// OSStatus codes (SInt32).
const errSecSuccess = 0;
const errSecItemNotFound = -25300;
const errSecDuplicateItem = -25299;

const dec = new TextDecoder();

/** UTF-8 bytes as an ArrayBuffer-backed array (FFI buffer params require it). */
function u8(s: string): Uint8Array<ArrayBuffer> {
  const e = new TextEncoder().encode(s);
  const out = new Uint8Array(e.length);
  out.set(e);
  return out;
}

type SecuritySymbols = Deno.DynamicLibrary<{
  SecKeychainAddGenericPassword: {
    parameters: ["pointer", "u32", "buffer", "u32", "buffer", "u32", "buffer", "pointer"];
    result: "i32";
  };
  SecKeychainFindGenericPassword: {
    parameters: ["pointer", "u32", "buffer", "u32", "buffer", "buffer", "buffer", "buffer"];
    result: "i32";
  };
  SecKeychainItemModifyAttributesAndData: {
    parameters: ["pointer", "pointer", "u32", "buffer"];
    result: "i32";
  };
  SecKeychainItemDelete: { parameters: ["pointer"]; result: "i32" };
  SecKeychainItemFreeContent: { parameters: ["pointer", "pointer"]; result: "i32" };
}>;

class MacosKeychainBackend implements KeychainBackend {
  readonly platform = "macos" as const;

  constructor(private readonly lib: SecuritySymbols) {}

  /** Find an item; returns its itemRef pointer (for modify/delete) and,
   *  optionally, the decoded password. `null` itemRef ⇒ not found. */
  private find(
    service: Uint8Array<ArrayBuffer>,
    account: Uint8Array<ArrayBuffer>,
    wantPassword: boolean,
  ): { status: number; itemRef: Deno.PointerValue; password: string | null } {
    const itemRef = new BigUint64Array(1);
    const pwLen = wantPassword ? new Uint32Array(1) : null;
    const pwData = wantPassword ? new BigUint64Array(1) : null;
    const status = this.lib.symbols.SecKeychainFindGenericPassword(
      null,
      service.length,
      service,
      account.length,
      account,
      pwLen,
      pwData,
      itemRef,
    );
    if (status !== errSecSuccess) {
      return { status, itemRef: null, password: null };
    }
    let password: string | null = null;
    if (wantPassword && pwData && pwLen) {
      const dataPtr = Deno.UnsafePointer.create(pwData[0]);
      if (dataPtr) {
        const bytes = new Deno.UnsafePointerView(dataPtr).getArrayBuffer(pwLen[0]);
        password = dec.decode(bytes);
        this.lib.symbols.SecKeychainItemFreeContent(null, dataPtr);
      } else {
        password = "";
      }
    }
    return { status, itemRef: Deno.UnsafePointer.create(itemRef[0]), password };
  }

  get(service: string, account: string): KeychainOutcome<string> {
    const svc = u8(service);
    const acc = u8(account);
    const { status, password } = this.find(svc, acc, true);
    if (status === errSecItemNotFound) return { kind: "miss" };
    if (status !== errSecSuccess || password === null) return { kind: "unavailable" };
    return { kind: "ok", value: password };
  }

  set(service: string, account: string, secret: string): KeychainOutcome<void> {
    const svc = u8(service);
    const acc = u8(account);
    const data = u8(secret);
    const add = this.lib.symbols.SecKeychainAddGenericPassword(
      null,
      svc.length,
      svc,
      acc.length,
      acc,
      data.length,
      data,
      null,
    );
    if (add === errSecSuccess) return { kind: "ok", value: undefined };
    if (add !== errSecDuplicateItem) return { kind: "unavailable" };
    // Item exists → modify its data in place (atomic: prior item stays until replaced).
    const { itemRef } = this.find(svc, acc, false);
    if (!itemRef) return { kind: "unavailable" };
    const mod = this.lib.symbols.SecKeychainItemModifyAttributesAndData(
      itemRef,
      null,
      data.length,
      data,
    );
    return mod === errSecSuccess ? { kind: "ok", value: undefined } : { kind: "unavailable" };
  }

  remove(service: string, account: string): KeychainOutcome<void> {
    const svc = u8(service);
    const acc = u8(account);
    const { status, itemRef } = this.find(svc, acc, false);
    if (status === errSecItemNotFound) return { kind: "ok", value: undefined }; // idempotent
    if (!itemRef) return { kind: "unavailable" };
    const del = this.lib.symbols.SecKeychainItemDelete(itemRef);
    return del === errSecSuccess ? { kind: "ok", value: undefined } : { kind: "unavailable" };
  }

  reachable(): boolean {
    // A sentinel lookup: both "found" and "not found" mean the keychain answered.
    // Any other status (locked / auth failure on a headless session) ⇒ fall back.
    const svc = u8(KEYCHAIN_SERVICE);
    const acc = u8("__probe__");
    const { status } = this.find(svc, acc, false);
    return status === errSecSuccess || status === errSecItemNotFound;
  }
}

/** Open the macOS backend. Throws (PermissionDenied / library missing) if FFI
 *  is unavailable; the caller (select.ts) treats any throw as "no keyring". */
export function openMacosBackend(): KeychainBackend {
  const lib = Deno.dlopen(SECURITY_PATH, {
    SecKeychainAddGenericPassword: {
      parameters: ["pointer", "u32", "buffer", "u32", "buffer", "u32", "buffer", "pointer"],
      result: "i32",
    },
    SecKeychainFindGenericPassword: {
      parameters: ["pointer", "u32", "buffer", "u32", "buffer", "buffer", "buffer", "buffer"],
      result: "i32",
    },
    SecKeychainItemModifyAttributesAndData: {
      parameters: ["pointer", "pointer", "u32", "buffer"],
      result: "i32",
    },
    SecKeychainItemDelete: { parameters: ["pointer"], result: "i32" },
    SecKeychainItemFreeContent: { parameters: ["pointer", "pointer"], result: "i32" },
  });
  return new MacosKeychainBackend(lib);
}
