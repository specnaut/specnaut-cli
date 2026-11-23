import { assertEquals, assertStringIncludes } from "@std/assert";
import { RELEASE_REPO } from "../../src/domain/release.ts";
import {
  ATTESTATION_ASSET_NAME,
  expectedSignerIdentity,
  FIRST_SIGNED_VERSION,
  GITHUB_ACTIONS_OIDC_ISSUER,
} from "../../src/domain/sigstore/trust_anchor.ts";
import { ignore, inSandbox, install } from "./install_sh_sandbox.ts";

/**
 * cli#817 — `install.sh` is shell and cannot import the trust anchor `self-update` checks, so it
 * spells the same values again: the signer identity per tag, the OIDC issuer, the bundle's asset
 * name, the first signed version. Each is read here from what the script says it would do
 * (`DRY_RUN=1`), on shared vectors, and held to `src/domain/sigstore/trust_anchor.ts`.
 */

/** What install.sh would do for `version`: the bundle it fetches and the identity it requires. */
async function plan(version: string): Promise<{ code: number; bundle: string; verify: string }> {
  let result = { code: -1, bundle: "", verify: "" };
  await inSandbox({}, async (s) => {
    const { code, out } = await install(s, { SPECNAUT_VERSION: version, DRY_RUN: "1" });
    const line = (re: RegExp) => out.split("\n").map((l) => l.trim()).find((l) => re.test(l)) ?? "";
    result = { code, bundle: line(/sigstore/), verify: line(/^(verify|check) /) };
  });
  return result;
}

for (const version of ["10.0.0", "4.10.0", FIRST_SIGNED_VERSION, "9.4.0", "10.0.0-rc.1"]) {
  Deno.test(
    { name: `install.sh pins the identity self-update pins, for ${version}`, ignore },
    async () => {
      const got = await plan(`v${version}`);
      const expected = expectedSignerIdentity(version);
      assertEquals(got.code, 0);
      assertEquals(
        got.verify,
        `verify the attestation for ${expected} (issuer ${GITHUB_ACTIONS_OIDC_ISSUER})`,
      );
      assertEquals(
        got.bundle,
        `https://github.com/${RELEASE_REPO}/releases/download/v${version}/${ATTESTATION_ASSET_NAME}`,
      );
    },
  );
}

Deno.test(
  { name: "install.sh signs from FIRST_SIGNED_VERSION, and not before", ignore },
  async () => {
    assertStringIncludes((await plan(FIRST_SIGNED_VERSION)).verify, "verify the attestation");
    assertStringIncludes((await plan(`${FIRST_SIGNED_VERSION}-rc.1`)).verify, "checksum only");
  },
);
