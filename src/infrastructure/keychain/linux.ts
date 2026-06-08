// Linux keychain backend (#360) — libsecret via Deno FFI.
//
// libsecret's convenience helpers (secret_password_store_sync &c.) are VARIADIC,
// which Deno FFI cannot call; we use the non-variadic `*v_sync` variants that
// take a GHashTable of attributes plus a SecretSchema we build in memory. The
// password is a C-string ARGUMENT to the in-process call — never an argv
// (FR-002). The `secret-tool` CLI is deliberately avoided (its `store` form
// would put the value on argv).
//
// Untestable in CI (no Secret Service); every operation is wrapped so any FFI
// fault reports `unavailable`, degrading safely to the file store (FR-003).

import {
  KEYCHAIN_SERVICE,
  type KeychainBackend,
  type KeychainOutcome,
} from "./keychain_backend.ts";

/** A null-terminated C string as a stable ArrayBuffer-backed array (FFI buffer
 *  params require `<ArrayBuffer>`; kept alive by the caller). */
function cstr(s: string): Uint8Array<ArrayBuffer> {
  const e = new TextEncoder().encode(s + "\0");
  const out = new Uint8Array(e.length);
  out.set(e);
  return out;
}

// SECRET_SCHEMA_NONE = 0; SECRET_SCHEMA_ATTRIBUTE_STRING = 0.
// SecretSchema (64-bit): name ptr(8) | flags i32(4)+pad(4) | attributes[32] of
// {name ptr(8), type i32(4)+pad(4)} = 512 | reserved i32(4)+pad(4) | 7 ptrs(56)
// = 592 bytes. We fill name + two string attributes (service, account) + a NULL
// terminator entry; the rest stays zero.
const SCHEMA_SIZE = 592;
const ATTRS_OFFSET = 16;
const ATTR_STRIDE = 16;

class LibsecretBackend implements KeychainBackend {
  readonly platform = "linux" as const;

  // Kept alive for the lifetime of the backend (the schema holds raw pointers
  // into these buffers).
  #buffers: Uint8Array<ArrayBuffer>[] = [];
  #schema: Uint8Array<ArrayBuffer>;
  #hashCb: Deno.UnsafeCallback<{ parameters: ["pointer"]; result: "u32" }>;
  #equalCb: Deno.UnsafeCallback<{ parameters: ["pointer", "pointer"]; result: "i32" }>;

  constructor(
    private readonly secret: LibsecretSymbols,
    private readonly glib: GlibSymbols,
  ) {
    const schema = new Uint8Array(SCHEMA_SIZE);
    const view = new DataView(schema.buffer);
    const put = (off: number, ptr: Deno.PointerValue) =>
      view.setBigUint64(off, BigInt(Deno.UnsafePointer.value(ptr)), true);

    const name = cstr("org.specflow.cloud");
    const aService = cstr("service");
    const aAccount = cstr("account");
    this.#buffers.push(schema, name, aService, aAccount);

    put(0, Deno.UnsafePointer.of(name)); // schema.name
    // schema.flags (offset 8) = 0
    put(ATTRS_OFFSET + 0 * ATTR_STRIDE, Deno.UnsafePointer.of(aService));
    put(ATTRS_OFFSET + 1 * ATTR_STRIDE, Deno.UnsafePointer.of(aAccount));
    // attributes[2].name = NULL terminator (already zero)
    this.#schema = schema;

    // g_str_hash / g_str_equal reimplemented as callbacks so we need no native
    // function-pointer symbols.
    this.#hashCb = new Deno.UnsafeCallback(
      { parameters: ["pointer"], result: "u32" } as const,
      (p: Deno.PointerValue) => {
        const s = p ? new Deno.UnsafePointerView(p).getCString() : "";
        let h = 5381;
        for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
        return h >>> 0;
      },
    );
    this.#equalCb = new Deno.UnsafeCallback(
      { parameters: ["pointer", "pointer"], result: "i32" } as const,
      (a: Deno.PointerValue, b: Deno.PointerValue) => {
        const sa = a ? new Deno.UnsafePointerView(a).getCString() : "";
        const sb = b ? new Deno.UnsafePointerView(b).getCString() : "";
        return sa === sb ? 1 : 0;
      },
    );
  }

  private schemaPtr(): Deno.PointerValue {
    return Deno.UnsafePointer.of(this.#schema);
  }

  /** A GHashTable{service, account} of C-string keys/values (kept alive via `hold`). */
  private attrs(service: string, account: string, hold: Uint8Array[]): Deno.PointerValue {
    const table = this.glib.symbols.g_hash_table_new(this.#hashCb.pointer, this.#equalCb.pointer);
    const insert = (k: string, v: string) => {
      const kb = cstr(k), vb = cstr(v);
      hold.push(kb, vb);
      this.glib.symbols.g_hash_table_insert(
        table,
        Deno.UnsafePointer.of(kb),
        Deno.UnsafePointer.of(vb),
      );
    };
    insert("service", service);
    insert("account", account);
    return table;
  }

  get(service: string, account: string): KeychainOutcome<string> {
    try {
      const hold: Uint8Array[] = [];
      const table = this.attrs(service, account, hold);
      const err = new BigUint64Array(1);
      const res = this.secret.symbols.secret_password_lookupv_sync(
        this.schemaPtr(),
        table,
        null,
        err,
      );
      this.glib.symbols.g_hash_table_destroy(table);
      if (err[0] !== 0n) {
        this.glib.symbols.g_error_free(Deno.UnsafePointer.create(err[0]));
        return { kind: "unavailable" };
      }
      const ptr = Deno.UnsafePointer.create(res ? Deno.UnsafePointer.value(res) : 0n);
      if (!ptr) return { kind: "miss" };
      const value = new Deno.UnsafePointerView(ptr).getCString();
      this.secret.symbols.secret_password_free(ptr);
      return { kind: "ok", value };
    } catch {
      return { kind: "unavailable" };
    }
  }

  set(service: string, account: string, secret: string): KeychainOutcome<void> {
    try {
      const hold: Uint8Array[] = [];
      const table = this.attrs(service, account, hold);
      const label = cstr(`${KEYCHAIN_SERVICE}: ${account}`);
      const pw = cstr(secret);
      const err = new BigUint64Array(1);
      const ok = this.secret.symbols.secret_password_storev_sync(
        this.schemaPtr(),
        table,
        null, // default collection
        Deno.UnsafePointer.of(label),
        Deno.UnsafePointer.of(pw),
        null,
        err,
      );
      this.glib.symbols.g_hash_table_destroy(table);
      if (err[0] !== 0n) {
        this.glib.symbols.g_error_free(Deno.UnsafePointer.create(err[0]));
        return { kind: "unavailable" };
      }
      return ok ? { kind: "ok", value: undefined } : { kind: "unavailable" };
    } catch {
      return { kind: "unavailable" };
    }
  }

  remove(service: string, account: string): KeychainOutcome<void> {
    try {
      const hold: Uint8Array[] = [];
      const table = this.attrs(service, account, hold);
      const err = new BigUint64Array(1);
      // Return value ignored: `false` with no GError means "nothing matched",
      // which is an idempotent success for delete.
      this.secret.symbols.secret_password_clearv_sync(this.schemaPtr(), table, null, err);
      this.glib.symbols.g_hash_table_destroy(table);
      if (err[0] !== 0n) {
        this.glib.symbols.g_error_free(Deno.UnsafePointer.create(err[0]));
        return { kind: "unavailable" };
      }
      return { kind: "ok", value: undefined };
    } catch {
      return { kind: "unavailable" };
    }
  }

  reachable(): boolean {
    // A lookup of a sentinel: a clean result (hit or miss, no GError) means the
    // Secret Service answered. Any throw / error ⇒ no reachable keyring.
    const probe = this.get(KEYCHAIN_SERVICE, "__probe__");
    return probe.kind !== "unavailable";
  }
}

type LibsecretSymbols = Deno.DynamicLibrary<{
  secret_password_storev_sync: {
    parameters: ["pointer", "pointer", "pointer", "pointer", "pointer", "pointer", "buffer"];
    result: "i32";
  };
  secret_password_lookupv_sync: {
    parameters: ["pointer", "pointer", "pointer", "buffer"];
    result: "pointer";
  };
  secret_password_clearv_sync: {
    parameters: ["pointer", "pointer", "pointer", "buffer"];
    result: "i32";
  };
  secret_password_free: { parameters: ["pointer"]; result: "void" };
}>;

type GlibSymbols = Deno.DynamicLibrary<{
  g_hash_table_new: { parameters: ["pointer", "pointer"]; result: "pointer" };
  g_hash_table_insert: { parameters: ["pointer", "pointer", "pointer"]; result: "i32" };
  g_hash_table_destroy: { parameters: ["pointer"]; result: "void" };
  g_error_free: { parameters: ["pointer"]; result: "void" };
}>;

/** Open the Linux backend. Throws if libsecret/glib are missing or FFI is
 *  denied; select.ts treats any throw as "no keyring". */
export function openLinuxBackend(): KeychainBackend {
  const secret = Deno.dlopen("libsecret-1.so.0", {
    secret_password_storev_sync: {
      parameters: ["pointer", "pointer", "pointer", "pointer", "pointer", "pointer", "buffer"],
      result: "i32",
    },
    secret_password_lookupv_sync: {
      parameters: ["pointer", "pointer", "pointer", "buffer"],
      result: "pointer",
    },
    secret_password_clearv_sync: {
      parameters: ["pointer", "pointer", "pointer", "buffer"],
      result: "i32",
    },
    secret_password_free: { parameters: ["pointer"], result: "void" },
  });
  const glib = Deno.dlopen("libglib-2.0.so.0", {
    g_hash_table_new: { parameters: ["pointer", "pointer"], result: "pointer" },
    g_hash_table_insert: { parameters: ["pointer", "pointer", "pointer"], result: "i32" },
    g_hash_table_destroy: { parameters: ["pointer"], result: "void" },
    g_error_free: { parameters: ["pointer"], result: "void" },
  });
  return new LibsecretBackend(secret, glib);
}
