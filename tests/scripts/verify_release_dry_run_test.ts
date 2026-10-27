import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import {
  issueSigningCert,
  makeAuthority,
  makeBundle,
  testRekorPublicKeyDer,
} from "../helpers/sigstore_fixture.ts";
import {
  DRY_RUN_REF,
  dryRunSignerIdentity,
  identityFor,
  parseCommandLine,
  targetsFor,
  verifyReleaseDir,
} from "../../scripts/verify-release.ts";
import { TARGETS } from "../../scripts/build.ts";
import {
  ATTESTATION_ASSET_NAME,
  expectedSignerIdentity,
} from "../../src/domain/sigstore/trust_anchor.ts";

/**
 * cli#662 — `--dry-run-ref` checks what the dispatch-only Go dry run attested.
 *
 * The identity is derived from the ref, exact, and the flag cannot be combined
 * with `--tag`: a free-form identity, a prefix match, or a precedence rule
 * between the two would each let a dry-run certificate stand in for a release
 * check. A release never passes the flag, which is asserted on the two files
 * that run the release check.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SCRIPT = fromFileUrl(new URL("../../scripts/verify-release.ts", import.meta.url));
const OIDC = "https://token.actions.githubusercontent.com";
const NOW = new Date("2025-01-01T00:00:00Z");
const TARGET = { outName: "specnaut-linux-x64" } as const;

Deno.test("the dry-run identity is the go-dry-run.yml workflow at that ref, exactly", () => {
  assertEquals(
    dryRunSignerIdentity("refs/heads/main"),
    "https://github.com/specnaut/specnaut-cli/.github/workflows/go-dry-run.yml@refs/heads/main",
  );
  assertEquals(
    identityFor({ tag: null, dryRunRef: "refs/heads/main" })?.identity,
    dryRunSignerIdentity("refs/heads/main"),
  );
  assertEquals(
    identityFor({ tag: "v1.2.3", dryRunRef: null })?.identity,
    expectedSignerIdentity("1.2.3"),
  );
});

Deno.test("--tag and --dry-run-ref are exclusive, and the only ref is main", () => {
  assertEquals(DRY_RUN_REF, "refs/heads/main");
  assertEquals(identityFor({ tag: "v1.2.3", dryRunRef: "refs/heads/main" }), null);
  assertEquals(identityFor({ tag: null, dryRunRef: null }), null);
  for (
    const ref of [
      "main",
      "refs/heads/*",
      "refs/heads/a b",
      "refs/heads/x@y",
      "refs/pull/1/merge",
      // Well-formed, but go-dry-run.yml never runs there: no such certificate.
      "refs/heads/feature",
      "refs/heads/main2",
      "refs/tags/v1.2.3",
    ]
  ) {
    assertEquals(identityFor({ tag: null, dryRunRef: ref }), null, `${ref} was accepted`);
  }
});

Deno.test("the command line needs a directory and exactly one identity", () => {
  assertEquals(
    parseCommandLine(["--dry-run-ref", "refs/heads/main", "--dir", "d"])?.wanted.identity,
    dryRunSignerIdentity("refs/heads/main"),
  );
  assertEquals(parseCommandLine(["--dry-run-ref", "refs/heads/main"]), null);
  assertEquals(parseCommandLine(["--dry-run-ref", "refs/heads/feature", "--dir", "d"]), null);
  assertEquals(parseCommandLine(["--tag", "v1.2.3", "--dir", "d", "--only", "x"]), null);
  assertEquals(parseCommandLine(["--tag", "v1.2.3", "--dir", "d"])?.targets, TARGETS);
});

Deno.test("the entrypoint exits 2 when given both --tag and --dry-run-ref", async () => {
  const { code } = await new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      SCRIPT,
      "--tag",
      "v1.2.3",
      "--dry-run-ref",
      "refs/heads/main",
      "--dir",
      ".",
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(code, 2);
});

async function signedDir(
  sanUri: string,
): Promise<{ dir: string; anchor: Parameters<typeof verifyReleaseDir>[0]["anchor"] }> {
  const dir = await Deno.makeTempDir({ prefix: "verify-dry-run-" });
  const bytes = new TextEncoder().encode("a go binary");
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  const sha256 = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const authority = await makeAuthority();
  const signer = await issueSigningCert(authority, {
    sanUri,
    oidcIssuer: OIDC,
    notBefore: new Date("2024-01-01T00:00:00Z"),
    notAfter: new Date("2030-01-01T00:00:00Z"),
  });
  await Deno.writeTextFile(
    `${dir}/${ATTESTATION_ASSET_NAME}`,
    await makeBundle(signer, { subjects: [{ name: TARGET.outName, sha256 }] }),
  );
  await Deno.writeFile(`${dir}/${TARGET.outName}`, bytes);
  const anchor = {
    issuerCertDer: authority.certDer,
    expectedOidcIssuer: OIDC,
    rekorPublicKeyDer: await testRekorPublicKeyDer(),
  };
  return { dir, anchor };
}

Deno.test("a dry-run bundle verifies as a dry run and is refused as a release", async () => {
  const { dir, anchor } = await signedDir(dryRunSignerIdentity("refs/heads/main"));
  try {
    const verify = (identity: string) =>
      verifyReleaseDir({ dir, identity, anchor, now: NOW, targets: [TARGET] });
    const asDryRun = await verify(dryRunSignerIdentity("refs/heads/main"));
    assertEquals(asDryRun.map((r) => r.ok), [true], JSON.stringify(asDryRun));
    const asRelease = await verify(expectedSignerIdentity("1.2.3"));
    assertEquals(asRelease.map((r) => r.reason), ["identity-mismatch"]);
    const otherRef = await verify(dryRunSignerIdentity("refs/heads/feature"));
    assertEquals(otherRef.map((r) => r.reason), ["identity-mismatch"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("neither postflight nor release.yml ever passes --dry-run-ref", async () => {
  for (const file of [".specnaut/release/postflight.sh", ".github/workflows/release.yml"]) {
    const text = await Deno.readTextFile(`${ROOT}${file}`);
    assert(
      !text.includes("--dry-run-ref"),
      `${file} passes --dry-run-ref: a release check would accept a dry run`,
    );
  }
  const postflight = await Deno.readTextFile(`${ROOT}.specnaut/release/postflight.sh`);
  assert(
    postflight.includes("verify-release.ts"),
    "postflight no longer runs verify-release.ts — re-aim this test",
  );
});

Deno.test("--only narrows to one known asset and refuses an unknown one", () => {
  assertEquals(targetsFor(null), TARGETS, "without --only every target is checked");
  assertEquals(targetsFor("specnaut-linux-x64")?.map((t) => t.outName), ["specnaut-linux-x64"]);
  assertEquals(targetsFor("specnaut-*"), null);
  assertEquals(targetsFor("specnaut.attestation.sigstore.json"), null);
});
