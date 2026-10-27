import { assertEquals } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { CREDENTIALW } from "../../src/infrastructure/keychain/windows.ts";

/**
 * The Windows backend shipped with every CREDENTIALW field one slot late, so
 * CredWriteW refused every write and CredReadW's result crashed the process.
 * Nothing caught it: the backend's header called it untestable in CI, while
 * CI's cross-smoke job runs this suite on windows-latest.
 *
 * Two guards. The layout is derived here from wincred.h's field list with
 * natural alignment — an independent computation, not a copy of the
 * constants — and checked on every OS. The roundtrip runs only on Windows,
 * against the real Credential Manager, under a probe-only service name.
 */

type Field = readonly [name: string, size: number];

// wincred.h, CREDENTIALW, in declaration order. Pointers are 8 bytes on Win64.
const FIELDS: readonly Field[] = [
  ["Flags", 4],
  ["Type", 4],
  ["TargetName", 8],
  ["Comment", 8],
  ["LastWritten", 8], // FILETIME: two DWORDs, 4-byte aligned, lands on 24
  ["CredentialBlobSize", 4],
  ["CredentialBlob", 8],
  ["Persist", 4],
  ["AttributeCount", 4],
  ["Attributes", 8],
  ["TargetAlias", 8],
  ["UserName", 8],
];

function layout(): { offsets: Record<string, number>; size: number } {
  const offsets: Record<string, number> = {};
  let at = 0;
  for (const [name, size] of FIELDS) {
    const align = name === "LastWritten" ? 4 : size;
    at = Math.ceil(at / align) * align;
    offsets[name] = at;
    at += size;
  }
  return { offsets, size: Math.ceil(at / 8) * 8 };
}

Deno.test("CREDENTIALW offsets follow the Win64 layout of wincred.h", () => {
  const { offsets, size } = layout();
  assertEquals(CREDENTIALW, {
    size,
    type: offsets.Type,
    targetName: offsets.TargetName,
    blobSize: offsets.CredentialBlobSize,
    blob: offsets.CredentialBlob,
    persist: offsets.Persist,
  });
});

const SERVICE = "specnaut-keychain-test";

// Runs the shipped backend in a child with --allow-ffi: the suite's own
// permissions deliberately do not include FFI.
const ROUNDTRIP = (backendUrl: string) => `
import { openWindowsBackend } from ${JSON.stringify(backendUrl)};
const b = openWindowsBackend();
const secret = crypto.randomUUID();
const out = [];
try {
  out.push(b.set(${JSON.stringify(SERVICE)}, "roundtrip", secret).kind);
  const got = b.get(${JSON.stringify(SERVICE)}, "roundtrip");
  out.push(got.kind === "ok" && got.value === secret ? "match" : "mismatch:" + got.kind);
  out.push(b.remove(${JSON.stringify(SERVICE)}, "roundtrip").kind);
  out.push(b.get(${JSON.stringify(SERVICE)}, "roundtrip").kind);
  const other = b.get(${JSON.stringify(SERVICE)}, "other-client");
  out.push("other:" + other.kind);
} finally {
  b.remove(${JSON.stringify(SERVICE)}, "roundtrip");
}
console.log(out.join(" "));
`;

async function run(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
  const o = await new Deno.Command(cmd, { args, stdout: "piped", stderr: "piped" }).output();
  const dec = new TextDecoder();
  return { code: o.code, out: dec.decode(o.stdout).trim() + dec.decode(o.stderr).trim() };
}

Deno.test({
  name: "the Windows backend stores, reads and removes a credential, and reads another client's",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const dir = await Deno.makeTempDir();
    const target = `${SERVICE}:other-client`;
    try {
      // Another Credential Manager client writes an item (cmdkey stores the
      // password as UTF-16, so only the outcome is compared, not the value).
      const added = await run("cmdkey", [`/generic:${target}`, "/user:probe", "/pass:probe"]);
      assertEquals(added.code, 0, added.out);
      const script = join(dir, "roundtrip.ts");
      const backend = toFileUrl(
        join(Deno.cwd(), "src", "infrastructure", "keychain", "windows.ts"),
      ).href;
      await Deno.writeTextFile(script, ROUNDTRIP(backend));
      const r = await run(Deno.execPath(), ["run", "--allow-ffi", "--allow-read", script]);
      assertEquals(r.code, 0, r.out);
      assertEquals(r.out, "ok match ok miss other:ok");
    } finally {
      await run("cmdkey", [`/delete:${target}`]);
      await Deno.remove(dir, { recursive: true });
    }
  },
});
