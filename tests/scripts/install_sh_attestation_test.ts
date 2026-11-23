import { assert, assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { RELEASE_REPO } from "../../src/domain/release.ts";
import {
  expectedSignerIdentity,
  GITHUB_ACTIONS_OIDC_ISSUER,
} from "../../src/domain/sigstore/trust_anchor.ts";
import { exists, ignore, inSandbox, install, type Sandbox, stubLog } from "./install_sh_sandbox.ts";

/**
 * cli#817 — `install.sh` checks the release's attestation with `gh attestation verify`, against the
 * identity `self-update` pins, before anything is placed or run. Without a gh that can, it keeps
 * the checksum and says how to verify afterwards; REQUIRE_ATTESTATION=1, or another REPO, stops
 * instead. Each case runs in the sandbox of `install_sh_sandbox.ts`, whose gh is a stub or absent.
 */

const ID = expectedSignerIdentity("9.9.9");
const MARKER = `attestation verified for ${ID}`;
const HINT = `gh attestation verify %DEST% --repo ${RELEASE_REPO} --cert-identity ${ID} ` +
  `--cert-oidc-issuer ${GITHUB_ACTIONS_OIDC_ISSUER} --deny-self-hosted-runners`;
const dest = (s: Sandbox) => join(s.home, "bin", "specnaut");

/** The gh calls logged by the stub, each as its argument list. */
async function ghCalls(s: Sandbox): Promise<string[][]> {
  const log = await stubLog(s, "gh");
  return log.split("--\n").filter(Boolean).map((c) => c.trimEnd().split("\n"));
}

/** Nothing placed, the binary never run, the download folder gone. */
async function assertRefused(s: Sandbox, r: { code: number; out: string }, reason: string) {
  assertEquals(r.code, 1, r.out);
  assertStringIncludes(r.out, reason);
  assert(!(await exists(dest(s))), "a binary was placed");
  assert(!r.out.includes("specnaut 9.9.9"), "the unverified binary was run");
  assertEquals(await Array.fromAsync(Deno.readDir(s.tmp)), [], "the download folder was left");
}

const test = (name: string, fn: () => Promise<void>) => Deno.test({ name, ignore, fn });

test("a valid attestation is checked with the pinned identity, then installed", () =>
  inSandbox({ gh: "valid" }, async (s) => {
    const r = await install(s);
    assertEquals(r.code, 0, r.out);
    assertStringIncludes(r.out, MARKER);
    assertStringIncludes(r.out, "specnaut 9.9.9");
    const calls = await ghCalls(s);
    assertEquals(calls[0], ["attestation", "verify", "--help"]);
    const [verb, sub, bin, ...flags] = calls[1];
    assertEquals([verb, sub, calls.length], ["attestation", "verify", 2]);
    assertMatch(bin, /\/specnaut$/);
    assert(bin.startsWith(s.tmp), `${bin} is not the download, under ${s.tmp}`);
    assertEquals(flags[1], bin.replace(/specnaut$/, "bundle.json"));
    assertEquals(flags.filter((_, i) => i !== 1), [
      ...["--bundle", "--repo", RELEASE_REPO, "--cert-identity", ID],
      ...["--cert-oidc-issuer", GITHUB_ACTIONS_OIDC_ISSUER, "--deny-self-hosted-runners"],
    ]);
  }));

test("a refused attestation stops the install before anything is placed or run", () =>
  inSandbox({ gh: "mismatch" }, async (s) => {
    const r = await install(s);
    await assertRefused(s, r, "gh refused the attestation for v9.9.9 (reason above)");
    assertStringIncludes(r.out, "verification failed"); // gh's own reason is shown
    assert(!r.out.includes(MARKER), r.out);
  }));

test("without gh the checksum still decides, and the warning says how to verify", () =>
  inSandbox({ gh: null }, async (s) => {
    const r = await install(s);
    assertEquals(r.code, 0, r.out);
    assertStringIncludes(r.out, "checked against its checksum only");
    assertStringIncludes(r.out, HINT.replace("%DEST%", dest(s)));
    assert(!r.out.includes(MARKER), r.out);
    assertEquals(await stubLog(s, "gh"), "");
  }));

test("without gh a bad checksum is still refused", () =>
  inSandbox({ gh: null, summed: "not the binary" }, async (s) => {
    await assertRefused(s, await install(s), "checksum mismatch");
  }));

test("a gh without `attestation` counts as missing, and is never asked to verify", () =>
  inSandbox({ gh: "no-attestation" }, async (s) => {
    const r = await install(s);
    assertEquals(r.code, 0, r.out);
    assertStringIncludes(r.out, HINT.replace("%DEST%", dest(s)));
    assertEquals(await ghCalls(s), [["attestation", "verify", "--help"]]);
  }));

test("REQUIRE_ATTESTATION=1 stops when gh cannot verify", () =>
  inSandbox({ gh: "no-attestation" }, async (s) => {
    const r = await install(s, { REQUIRE_ATTESTATION: "1" });
    await assertRefused(s, r, "REQUIRE_ATTESTATION is set, and gh");
  }));

test("a signed release without its bundle is refused, never read as unsigned", () =>
  inSandbox({ missing: "/specnaut.attestation.sigstore.json" }, async (s) => {
    const r = await install(s);
    await assertRefused(s, r, "v9.9.9 carries no attestation bundle");
    assertEquals(await ghCalls(s), [["attestation", "verify", "--help"]]);
  }));

test("another REPO is held to the canonical signer, and never installs on a checksum", async () => {
  await inSandbox({ gh: "valid" }, async (s) => {
    const r = await install(s, { REPO: "someone/mirror" });
    assertEquals(r.code, 0, r.out);
    assertStringIncludes(r.out, MARKER);
    const verify = (await ghCalls(s))[1];
    assertEquals(verify[verify.indexOf("--repo") + 1], RELEASE_REPO);
    assertStringIncludes(await stubLog(s, "curl"), "github.com/someone/mirror/releases/download/");
  });
  await inSandbox({ gh: null }, async (s) => {
    await assertRefused(s, await install(s, { REPO: "someone/mirror" }), "REQUIRE_ATTESTATION");
  });
});
