import { assert, assertEquals } from "@std/assert";
import { encodeBase64 } from "@std/encoding/base64";
import { fromFileUrl, join } from "@std/path";
import {
  ATTESTATION_BUNDLES,
  INSTALLER_ASSET_NAME,
  INSTALLER_ATTESTATION_ASSET_NAME,
  subjectProblems,
} from "../../scripts/release/attestation-bundles.ts";
import { ATTESTATION_ASSET_NAME } from "../../src/domain/sigstore/trust_anchor.ts";
import { TARGETS } from "../../scripts/build.ts";

/**
 * The binaries and the installer are attested in two bundles, so a digest in the binary bundle is
 * a binary's and nothing else's. The release checks each staged bundle's subject list before upload;
 * these prove that check refuses a binary bundle that also covers the installer.
 */

const SCRIPT = fromFileUrl(
  new URL("../../scripts/release/attestation-bundles.ts", import.meta.url),
);
const REAL = Deno.readTextFileSync(
  fromFileUrl(new URL("../fixtures/sigstore/v4.3.0.attestation.sigstore.json", import.meta.url)),
);
const BINARIES = TARGETS.map((t) => t.outName);

/** The published v4.3.0 bundle with its statement's subjects replaced by `names`. */
function bundleCovering(names: readonly string[]): string {
  const bundle = JSON.parse(REAL);
  const subject = names.map((name) => ({ name, digest: { sha256: "a".repeat(64) } }));
  const statement = { _type: "https://in-toto.io/Statement/v1", subject };
  bundle.dsseEnvelope.payload = encodeBase64(new TextEncoder().encode(JSON.stringify(statement)));
  return JSON.stringify(bundle);
}

Deno.test("the binary bundle covers exactly the binaries, the installer bundle the installer", () => {
  assertEquals(
    ATTESTATION_BUNDLES.map((b) => [b.bundle, [...b.subjects]]),
    [[ATTESTATION_ASSET_NAME, BINARIES], [INSTALLER_ATTESTATION_ASSET_NAME, [
      INSTALLER_ASSET_NAME,
    ]]],
  );
  assert(!INSTALLER_ATTESTATION_ASSET_NAME.startsWith("specnaut-"), "it would gain a .sha256");
});

Deno.test("a published binary bundle holds exactly the binaries", () => {
  assertEquals(subjectProblems(REAL, BINARIES), []);
});

Deno.test("a binary bundle that also covers the installer is refused", () => {
  assertEquals(subjectProblems(bundleCovering([...BINARIES, INSTALLER_ASSET_NAME]), BINARIES), [
    `${INSTALLER_ASSET_NAME} does not belong in it`,
  ]);
});

Deno.test("a binary bundle missing a binary is refused", () => {
  assertEquals(subjectProblems(bundleCovering(BINARIES.slice(1)), BINARIES), [
    `${BINARIES[0]} is missing from it`,
  ]);
});

/** Runs the release check's entrypoint on `dir`; its exit code and everything it printed. */
async function checkDir(dir: string) {
  const out = await new Deno.Command("deno", {
    args: ["run", "--allow-read", SCRIPT, dir],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const text = new TextDecoder().decode(out.stdout) + new TextDecoder().decode(out.stderr);
  return { code: out.code, text };
}

/** A staged dir holding `binaryBundle` (none when null) and a correct installer bundle. */
async function runCheck(binaryBundle: string | null) {
  const dir = await Deno.makeTempDir({ prefix: "attestation-bundles-" });
  try {
    if (binaryBundle !== null) {
      await Deno.writeTextFile(join(dir, ATTESTATION_ASSET_NAME), binaryBundle);
    }
    const installer = bundleCovering([INSTALLER_ASSET_NAME]);
    await Deno.writeTextFile(join(dir, INSTALLER_ATTESTATION_ASSET_NAME), installer);
    return await checkDir(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("the release check passes two bundles that each hold their own subjects", async () => {
  const { code, text } = await runCheck(REAL);
  assertEquals(code, 0, text);
  assert(text.includes(`ok ${INSTALLER_ATTESTATION_ASSET_NAME}`), text);
});

Deno.test("the release check fails a binary bundle that holds the installer, naming it", async () => {
  const { code, text } = await runCheck(bundleCovering([...BINARIES, INSTALLER_ASSET_NAME]));
  assertEquals(code, 1, text);
  assert(text.includes(`${ATTESTATION_ASSET_NAME}: ${INSTALLER_ASSET_NAME} does not belong`), text);
});

Deno.test("the release check fails when a bundle is absent", async () => {
  const { code, text } = await runCheck(null);
  assertEquals(code, 1, text);
  assert(text.includes(`${ATTESTATION_ASSET_NAME}: cannot be read`), text);
});
