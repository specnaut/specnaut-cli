import { assert, assertEquals, assertRejects } from "@std/assert";
import { SelfUpdateUseCase } from "../../src/application/self_update.ts";
import { Release, SemVer } from "../../src/domain/release.ts";
import type { Downloader, ReleaseChecker } from "../../src/application/ports.ts";

function fakeChecker(release: Release): ReleaseChecker {
  return { getLatest: () => Promise.resolve(release) };
}

function fakeDownloader(payload: Uint8Array, sha256: string): Downloader {
  return {
    download: () => Promise.resolve(payload),
    downloadText: (_url: string) => Promise.resolve(`${sha256}  file\n`),
  };
}

// SHA-256 of a single 0x00 byte:
const ZERO_BYTE = new Uint8Array([0]);
const ZERO_SHA = "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d";

Deno.test("SelfUpdateUseCase reports 'up-to-date' when current >= latest", async () => {
  const release = new Release(SemVer.parse("0.1.0"), [
    { name: "specnaut-macos-arm64", url: "https://x/bin" },
    { name: "specnaut-macos-arm64.sha256", url: "https://x/sha" },
  ]);
  const uc = new SelfUpdateUseCase({
    checker: fakeChecker(release),
    downloader: fakeDownloader(ZERO_BYTE, ZERO_SHA),
    currentVersion: "0.1.0",
    currentPlatform: "macos-arm64",
    currentBinaryPath: "/tmp/specnaut",
    replaceBinary: () => Promise.resolve(),
  });
  const result = await uc.execute({ checkOnly: false });
  assertEquals(result.status, "up-to-date");
});

Deno.test("SelfUpdateUseCase downloads, verifies, and replaces when newer", async () => {
  const release = new Release(SemVer.parse("0.2.0"), [
    { name: "specnaut-macos-arm64", url: "https://x/bin" },
    { name: "specnaut-macos-arm64.sha256", url: "https://x/sha" },
  ]);
  let replaced = false;
  const uc = new SelfUpdateUseCase({
    checker: fakeChecker(release),
    downloader: fakeDownloader(ZERO_BYTE, ZERO_SHA),
    currentVersion: "0.1.0",
    currentPlatform: "macos-arm64",
    currentBinaryPath: "/tmp/specnaut",
    replaceBinary: (bytes) => {
      assertEquals(bytes, ZERO_BYTE);
      replaced = true;
      return Promise.resolve();
    },
  });
  const result = await uc.execute({ checkOnly: false });
  assertEquals(result.status, "updated");
  assert(replaced);
});

Deno.test("SelfUpdateUseCase 'available' in check-only mode without downloading", async () => {
  const release = new Release(SemVer.parse("0.2.0"), [
    { name: "specnaut-macos-arm64", url: "https://x/bin" },
    { name: "specnaut-macos-arm64.sha256", url: "https://x/sha" },
  ]);
  let downloadCalled = false;
  const uc = new SelfUpdateUseCase({
    checker: fakeChecker(release),
    downloader: {
      download: () => {
        downloadCalled = true;
        return Promise.resolve(new Uint8Array());
      },
      downloadText: () => Promise.resolve(""),
    },
    currentVersion: "0.1.0",
    currentPlatform: "macos-arm64",
    currentBinaryPath: "/tmp/specnaut",
    replaceBinary: () => Promise.resolve(),
  });
  const result = await uc.execute({ checkOnly: true });
  assertEquals(result.status, "available");
  assertEquals(downloadCalled, false);
});

Deno.test("SelfUpdateUseCase rejects when SHA256 mismatches", async () => {
  const release = new Release(SemVer.parse("0.2.0"), [
    { name: "specnaut-macos-arm64", url: "https://x/bin" },
    { name: "specnaut-macos-arm64.sha256", url: "https://x/sha" },
  ]);
  const uc = new SelfUpdateUseCase({
    checker: fakeChecker(release),
    downloader: fakeDownloader(ZERO_BYTE, "deadbeef".padEnd(64, "0")),
    currentVersion: "0.1.0",
    currentPlatform: "macos-arm64",
    currentBinaryPath: "/tmp/specnaut",
    replaceBinary: () => Promise.resolve(),
  });
  await assertRejects(() => uc.execute({ checkOnly: false }), Error, "checksum");
});

Deno.test("SelfUpdateUseCase rejects when no asset matches the platform", async () => {
  const release = new Release(SemVer.parse("0.2.0"), [
    { name: "specnaut-other-platform", url: "https://x" },
  ]);
  const uc = new SelfUpdateUseCase({
    checker: fakeChecker(release),
    downloader: fakeDownloader(ZERO_BYTE, ZERO_SHA),
    currentVersion: "0.1.0",
    currentPlatform: "macos-arm64",
    currentBinaryPath: "/tmp/specnaut",
    replaceBinary: () => Promise.resolve(),
  });
  await assertRejects(() => uc.execute({ checkOnly: false }), Error, "platform");
});

// ---------------------------------------------------------------------------
// Release signing (#577). The checksum and the binary it describes come from
// the same release, so anyone who can amend one amends both. These cover the
// control that does not share a trust root with what it verifies.
// ---------------------------------------------------------------------------

import { DEFAULT_TRUST_ANCHOR, type SelfUpdateDeps } from "../../src/application/self_update.ts";
import {
  ATTESTATION_ASSET_NAME,
  expectedSignerIdentity,
  FIRST_SIGNED_VERSION,
  FULCIO_INTERMEDIATE_DER,
  GITHUB_ACTIONS_OIDC_ISSUER,
} from "../../src/domain/sigstore/trust_anchor.ts";
import {
  type Authority,
  issueSigningCert,
  makeAuthority,
  makeBundle,
} from "../helpers/sigstore_fixture.ts";

const SIGNED = "9.9.9"; // comfortably at or above FIRST_SIGNED_VERSION
const NOW = new Date("2026-06-01T12:00:00Z");

function signedRelease(version: string, opts: { withBundle: boolean }): Release {
  const assets = [
    { name: "specnaut-macos-arm64", url: "https://x/bin" },
    { name: "specnaut-macos-arm64.sha256", url: "https://x/sha" },
  ];
  if (opts.withBundle) assets.push({ name: ATTESTATION_ASSET_NAME, url: "https://x/bundle" });
  return new Release(SemVer.parse(version), assets);
}

/** Routes by URL, because the bundle and the checksum are both text downloads. */
function routingDownloader(sha256: string, bundleJson: string | null): Downloader {
  return {
    download: () => Promise.resolve(ZERO_BYTE),
    downloadText: (url: string) =>
      Promise.resolve(url.endsWith("/bundle") ? (bundleJson ?? "") : `${sha256}  file\n`),
  };
}

let testAuthority: Authority;
async function bundleFor(
  version: string,
  digest: string,
  opts: { identityVersion?: string } = {},
): Promise<string> {
  testAuthority ??= await makeAuthority();
  const cert = await issueSigningCert(testAuthority, {
    sanUri: expectedSignerIdentity(opts.identityVersion ?? version),
    oidcIssuer: GITHUB_ACTIONS_OIDC_ISSUER,
    notBefore: new Date(NOW.getTime() - 60_000),
    notAfter: new Date(NOW.getTime() + 60_000),
  });
  return await makeBundle(cert, { subjects: [{ name: "specnaut-macos-arm64", sha256: digest }] });
}

function useCaseWith(
  release: Release,
  downloader: Downloader,
  replaceBinary: SelfUpdateDeps["replaceBinary"],
): SelfUpdateUseCase {
  return new SelfUpdateUseCase({
    checker: fakeChecker(release),
    downloader,
    currentVersion: "0.1.0",
    currentPlatform: "macos-arm64",
    currentBinaryPath: "/tmp/specnaut",
    replaceBinary,
    now: () => NOW,
    trustAnchor: {
      issuerCertDer: testAuthority.certDer,
      expectedOidcIssuer: GITHUB_ACTIONS_OIDC_ISSUER,
    },
  });
}

Deno.test("the shipped trust anchor is the pinned Fulcio intermediate", () => {
  // The anchor is injectable so the success path is testable at all. This is
  // what stops the seam from becoming a way to ship a different trust root.
  assertEquals(DEFAULT_TRUST_ANCHOR.issuerCertDer, FULCIO_INTERMEDIATE_DER);
  assertEquals(DEFAULT_TRUST_ANCHOR.expectedOidcIssuer, GITHUB_ACTIONS_OIDC_ISSUER);
});

Deno.test("a signed release installs and reports its provenance", async () => {
  const release = signedRelease(SIGNED, { withBundle: true });
  const bundle = await bundleFor(SIGNED, ZERO_SHA);
  let replaced = false;
  const result = await useCaseWith(release, routingDownloader(ZERO_SHA, bundle), () => {
    replaced = true;
    return Promise.resolve();
  }).execute({ checkOnly: false });
  assertEquals(result.status, "updated");
  assert(result.status === "updated" && result.provenance === "signed", JSON.stringify(result));
  assert(replaced);
});

Deno.test("a release at or above the signing floor with NO bundle is refused", async () => {
  // The transition has to end. Without this, "no bundle" stays a warning
  // forever and the gate never closes — and an attacker's cheapest move
  // against a signature check is to delete the signature.
  let replaced = false;
  const err = await assertRejects(() =>
    useCaseWith(
      signedRelease(SIGNED, { withBundle: false }),
      routingDownloader(ZERO_SHA, null),
      () => {
        replaced = true;
        return Promise.resolve();
      },
    ).execute({ checkOnly: false })
  );
  assert(!replaced, "the installed binary must be untouched when verification cannot run");
  assert(
    (err as Error).message.includes(FIRST_SIGNED_VERSION),
    `error should name the signing floor: ${(err as Error).message}`,
  );
});

Deno.test("a release from before signing existed installs with a warning", async () => {
  const result = await useCaseWith(
    signedRelease("0.9.0", { withBundle: false }),
    routingDownloader(ZERO_SHA, null),
    () => Promise.resolve(),
  ).execute({ checkOnly: false });
  assert(result.status === "updated" && result.provenance === "checksum-only");
  assert(
    result.warnings.some((w) => w.includes(FIRST_SIGNED_VERSION)),
    `the weaker path must say so out loud: ${JSON.stringify(result.warnings)}`,
  );
});

Deno.test("a bundle that does not verify aborts before the binary is replaced", async () => {
  // The ordering that makes this a gate rather than a report. The signature is
  // over a DIFFERENT release's identity — a bundle lifted from another tag.
  let replaced = false;
  const bundle = await bundleFor(SIGNED, ZERO_SHA, { identityVersion: "1.0.0" });
  const err = await assertRejects(() =>
    useCaseWith(
      signedRelease(SIGNED, { withBundle: true }),
      routingDownloader(ZERO_SHA, bundle),
      () => {
        replaced = true;
        return Promise.resolve();
      },
    ).execute({ checkOnly: false })
  );
  assert(!replaced, "replaceBinary ran despite a failed signature check");
  assert(
    (err as Error).message.includes("identity-mismatch"),
    `the reason must be nameable: ${(err as Error).message}`,
  );
});

Deno.test("a bundle covering different bytes aborts before the binary is replaced", async () => {
  let replaced = false;
  const bundle = await bundleFor(SIGNED, "f".repeat(64));
  await assertRejects(() =>
    useCaseWith(
      signedRelease(SIGNED, { withBundle: true }),
      routingDownloader(ZERO_SHA, bundle),
      () => {
        replaced = true;
        return Promise.resolve();
      },
    ).execute({ checkOnly: false })
  );
  assert(!replaced);
});

Deno.test("a present-but-broken bundle is fatal even below the signing floor", async () => {
  // Publishing a bundle is a claim. A claim that fails to check is worse
  // evidence than none, so the transition version does not soften it.
  let replaced = false;
  await assertRejects(() =>
    useCaseWith(
      signedRelease("0.9.0", { withBundle: true }),
      routingDownloader(ZERO_SHA, "{not json"),
      () => {
        replaced = true;
        return Promise.resolve();
      },
    ).execute({ checkOnly: false })
  );
  assert(!replaced);
});
