import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { issueSigningCert, makeAuthority, makeBundle } from "../helpers/sigstore_fixture.ts";
import { verifyReleaseDir } from "../../scripts/verify-release.ts";
import { expectedSignerIdentity } from "../../src/domain/sigstore/trust_anchor.ts";
import { ATTESTATION_ASSET_NAME } from "../../src/domain/sigstore/trust_anchor.ts";

/**
 * cli#595 — the release check must be able to FAIL.
 *
 * `postflight.sh` verified the attestation's tag and its subject COUNT. It
 * never touched the issuer chain, the DSSE signature, or the artefact digests.
 * Those are the legs whose failure is fatal, and because
 * `FIRST_SIGNED_VERSION` is 4.3.0, the verifier is first exercised by users at
 * 4.3.1 — a defect in an unchecked leg would surface one release too late, on
 * an immutable release.
 *
 * So the point of these is not that a good release passes. It is that a bad one
 * is refused, for the right reason, with a non-zero exit. A check that has only
 * ever been observed green is indistinguishable from one that cannot fail —
 * which is the defect class the ticket exists to close, so proving the negative
 * is the acceptance criterion.
 *
 * A synthetic authority is used rather than the real Fulcio anchor because real
 * bundles are all valid, and mutating one by hand changes two things at once:
 * edit a SAN and the certificate signature breaks with it, so an identity test
 * would pass for the wrong reason. The production entrypoint passes the
 * compiled-in anchor — see `main` in `verify-release.ts`.
 */

const VERSION = "9.9.9";
const OIDC = "https://token.actions.githubusercontent.com";
const TARGETS = [{ outName: "specnaut-linux-x64" }, { outName: "specnaut-macos-arm64" }] as const;
/** Inside the synthetic certificate's validity window. */
const NOW = new Date("2025-01-01T00:00:00Z");

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A published release on disk: two binaries and a bundle that covers them.
 * `mutate` rewrites one binary AFTER the bundle was signed over the original —
 * exactly what a corrupted or swapped upload looks like.
 */
async function publishedRelease(opts: {
  mutate?: string;
  signerVersion?: string;
  foreignAuthority?: boolean;
} = {}): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "verify-release-" });
  const bytes: Record<string, Uint8Array> = {};
  for (const t of TARGETS) {
    bytes[t.outName] = new TextEncoder().encode(`binary contents of ${t.outName}`);
  }

  const subjects = await Promise.all(
    TARGETS.map(async (t) => ({ name: t.outName, sha256: await sha256Hex(bytes[t.outName]) })),
  );

  const authority = await makeAuthority();
  const signer = await issueSigningCert(
    opts.foreignAuthority ? await makeAuthority({ name: "some other authority" }) : authority,
    {
      sanUri: expectedSignerIdentity(opts.signerVersion ?? VERSION),
      oidcIssuer: OIDC,
      notBefore: new Date("2024-01-01T00:00:00Z"),
      notAfter: new Date("2030-01-01T00:00:00Z"),
    },
  );
  await Deno.writeTextFile(
    `${dir}/${ATTESTATION_ASSET_NAME}`,
    await makeBundle(signer, { subjects }),
  );

  // Written last, so a mutation lands after the statement was signed.
  if (opts.mutate !== undefined) {
    bytes[opts.mutate] = new TextEncoder().encode("tampered");
  }
  for (const t of TARGETS) await Deno.writeFile(`${dir}/${t.outName}`, bytes[t.outName]);

  // The anchor a caller must use for this fixture to verify at all.
  await Deno.writeTextFile(`${dir}/.authority`, JSON.stringify([...authority.certDer]));
  return dir;
}

function anchorOf(dir: string): Promise<{ issuerCertDer: Uint8Array; expectedOidcIssuer: string }> {
  return Deno.readTextFile(`${dir}/.authority`).then((t) => ({
    issuerCertDer: new Uint8Array(JSON.parse(t)),
    expectedOidcIssuer: OIDC,
  }));
}

async function run(dir: string, version = VERSION) {
  return await verifyReleaseDir({
    dir,
    version,
    anchor: await anchorOf(dir),
    now: NOW,
    targets: TARGETS,
  });
}

Deno.test("an intact release verifies every published binary", async () => {
  const dir = await publishedRelease();
  try {
    const r = await run(dir);
    assertEquals(r.length, TARGETS.length, "not every target was checked");
    assertEquals(
      r.filter((x) => !x.ok).map((x) => `${x.outName}:${x.reason}:${x.detail}`),
      [],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a mutated artefact is refused as digest-mismatch, and only that artefact", async () => {
  // THE acceptance criterion. The signature and identity are untouched and
  // still valid; only the bytes moved. An implementation that checked the
  // bundle but never hashed the downloads would pass this, which is precisely
  // what postflight did before.
  const dir = await publishedRelease({ mutate: "specnaut-linux-x64" });
  try {
    const r = await run(dir);
    const bad = r.find((x) => x.outName === "specnaut-linux-x64")!;
    assertEquals(bad.ok, false, "a tampered binary verified — the digest is not being checked");
    assertEquals(bad.reason, "digest-mismatch");

    // Scoped: the other binary is untouched and must still pass, or the check
    // is just failing everything and the first assertion proves nothing.
    const good = r.find((x) => x.outName === "specnaut-macos-arm64")!;
    assertEquals(good.ok, true, `the intact binary failed too: ${good.reason} ${good.detail}`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a bundle signed for a different version is refused as identity-mismatch", async () => {
  // A replayed bundle from another tag: valid signature, real authority, wrong
  // release. This is what the old SAN grep approximated, now checked by the
  // same code users run.
  const dir = await publishedRelease({ signerVersion: "1.0.0" });
  try {
    const r = await run(dir);
    assert(r.every((x) => !x.ok), "a bundle for another version was accepted");
    assertEquals(r[0].reason, "identity-mismatch");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a bundle from a foreign authority is refused as untrusted-issuer", async () => {
  const dir = await publishedRelease({ foreignAuthority: true });
  try {
    const r = await run(dir);
    assert(r.every((x) => !x.ok), "a bundle from an unpinned authority was accepted");
    assertEquals(r[0].reason, "untrusted-issuer");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a release with no bundle at all is refused, not skipped", async () => {
  const dir = await publishedRelease();
  try {
    await Deno.remove(`${dir}/${ATTESTATION_ASSET_NAME}`);
    const r = await run(dir);
    assert(r.every((x) => !x.ok && x.reason === "no-bundle"), "a missing bundle was tolerated");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a binary the release never published is reported, not silently skipped", async () => {
  // A short build glob. The old subject-COUNT check caught this shape; the
  // per-binary check must not lose it by iterating only what it happens to find
  // on disk.
  const dir = await publishedRelease();
  try {
    await Deno.remove(`${dir}/specnaut-macos-arm64`);
    const r = await run(dir);
    assertEquals(r.length, TARGETS.length, "a missing binary dropped out of the report entirely");
    const missing = r.find((x) => x.outName === "specnaut-macos-arm64")!;
    assertEquals(missing.ok, false);
    assertEquals(missing.reason, "missing");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ── The exit code, which is what postflight actually consumes ──────────────

Deno.test("the entrypoint exits non-zero when a binary does not verify", async () => {
  // `verifyReleaseDir` returning failures is worth nothing if `main` does not
  // turn them into a non-zero exit — postflight reads the code, not the array.
  // Driven with the REAL compiled-in anchor, which a synthetic bundle can never
  // satisfy, so this exercises the production wiring end to end.
  const dir = await publishedRelease({ mutate: "specnaut-linux-x64" });
  try {
    const { code, stderr } = await new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        fromFileUrl(new URL("../../scripts/verify-release.ts", import.meta.url)),
        "--tag",
        `v${VERSION}`,
        "--dir",
        dir,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();

    assert(code !== 0, "the entrypoint exited 0 on a release that does not verify");
    const err = new TextDecoder().decode(stderr);
    assert(
      err.includes("specnaut-linux-x64"),
      `the failure does not name the binary that failed:\n${err}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("the entrypoint refuses to run without its arguments", async () => {
  const { code } = await new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      fromFileUrl(new URL("../../scripts/verify-release.ts", import.meta.url)),
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(code !== 0, "a call with no arguments exited 0, which postflight would read as success");
});
