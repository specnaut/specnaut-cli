import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { parse } from "@std/yaml";

/**
 * The entitlements the macOS release binaries are signed with (cli#428).
 *
 * The hardened runtime is what notarization requires, and it forbids what V8
 * does: it compiles to memory it then executes. Two entitlements give exactly
 * that back — `allow-jit`, and `allow-unsigned-executable-memory`. Anything
 * beyond them reopens a door the hardened runtime closed:
 * `disable-library-validation` lets any dylib load into the process,
 * `allow-dyld-environment-variables` lets `DYLD_INSERT_LIBRARIES` inject one,
 * and `get-task-allow` lets another process attach and read its memory — the
 * stored credentials included. One line in a plist adds any of them, and nothing
 * else would notice. This does.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const ENTITLEMENTS = "packaging/macos/entitlements.plist";

const EXPECTED = [
  "com.apple.security.cs.allow-jit",
  "com.apple.security.cs.allow-unsigned-executable-memory",
];

/** Each `<key>` of the top-level dict, with the element that follows it. */
function entries(plist: string): [string, string][] {
  return [...plist.matchAll(/<key>([^<]*)<\/key>\s*(<[^>]+>)/g)].map((m) => [m[1], m[2]]);
}

Deno.test("the macOS entitlements are exactly allow-jit and allow-unsigned-executable-memory", async () => {
  const plist = await Deno.readTextFile(`${ROOT}${ENTITLEMENTS}`);
  const found = entries(plist);
  assertEquals(
    found.map(([k]) => k).sort(),
    EXPECTED,
    "an entitlement beyond these two weakens the hardened runtime of every macOS user's binary",
  );
  for (const [key, value] of found) assertEquals(value, "<true/>", `${key} is not plainly true`);
  // A key the scan cannot see is a key it cannot judge: every <key> element in
  // the file must be one of the entries read above.
  assertEquals((plist.match(/<key>/g) ?? []).length, found.length, "a <key> the scan missed");
});

Deno.test("release.yml signs with that file and no other", async () => {
  const wf = parse(await Deno.readTextFile(`${ROOT}.github/workflows/release.yml`)) as {
    jobs: Record<string, { steps?: { run?: string }[] }>;
  };
  const runs = Object.values(wf.jobs).flatMap((j) => j.steps ?? []).map((s) => s.run ?? "");
  const signing = runs.filter((r) => r.includes("rcodesign sign"));
  assert(signing.length > 0, "nothing in release.yml runs `rcodesign sign`");
  for (const run of signing) {
    const files = [...run.matchAll(/--entitlements-xml-file\s+"?([^\s"]+)/g)].map((m) => m[1]);
    assertEquals(files, [ENTITLEMENTS], "the signing step must name the pinned entitlements file");
  }
});
