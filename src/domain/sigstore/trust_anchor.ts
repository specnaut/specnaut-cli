/**
 * What this binary trusts, compiled in.
 *
 * `self-update` replaces the running binary, and that binary is the trust root
 * for every instruction file Specnaut writes into a project. So the anchor for
 * the check cannot itself be fetched from the release being verified — the
 * previous control compared a `.sha256` against the binary it shipped beside,
 * and anyone able to amend a release replaces both.
 *
 * ## The pins, and where they came from
 *
 * Public repositories are signed by the **public-good Sigstore instance**, so
 * these are Sigstore's Fulcio certificates, not GitHub's.
 *
 * The root was taken from two independent sources that agree byte for byte:
 * `sigstore/root-signing`'s `targets/fulcio_v1.crt.pem`, and the certificate
 * authority's own `https://fulcio.sigstore.dev/api/v2/trustBundle`. The
 * intermediate came from that trust bundle, and `trust_anchor_test.ts` verifies
 * it against the root — a wrong pin fails the suite rather than every user's
 * next update.
 *
 *     root          O=sigstore.dev CN=sigstore              expires 2031-10-05
 *     intermediate  O=sigstore.dev CN=sigstore-intermediate expires 2031-10-05
 *
 * ## The cost of pinning, stated rather than discovered
 *
 * A Sigstore intermediate rotation makes every already-installed binary fail
 * `self-update` until it is reinstalled. That is deliberate: the alternative —
 * falling back to the checksum when the anchor is unrecognised — is a downgrade
 * an attacker triggers by serving a bundle from any other authority, which
 * collapses the control back into the one it replaces. Fail closed, name the
 * reason, and point at the reinstall path.
 *
 * The bundle carries only the leaf certificate, so the intermediate cannot be
 * taken from the download and has to be pinned. The root is pinned too and used
 * only to check the intermediate in that test — belt and braces against pinning
 * a certificate nobody verified.
 */

import { decodeBase64 } from "@std/encoding/base64";
import { RELEASE_REPO } from "../release.ts";

/** `O=sigstore.dev, CN=sigstore` — the public-good Fulcio root. */
export const FULCIO_ROOT_DER: Uint8Array = decodeBase64(
  "MIIB9zCCAXygAwIBAgIUALZNAPFdxHPwjeDloDwyYChAO/4wCgYIKoZIzj0EAwMwKjEVMBMG" +
    "A1UEChMMc2lnc3RvcmUuZGV2MREwDwYDVQQDEwhzaWdzdG9yZTAeFw0yMTEwMDcxMzU2NTla" +
    "Fw0zMTEwMDUxMzU2NThaMCoxFTATBgNVBAoTDHNpZ3N0b3JlLmRldjERMA8GA1UEAxMIc2ln" +
    "c3RvcmUwdjAQBgcqhkjOPQIBBgUrgQQAIgNiAAT7XeFT4rb3PQGwS4IajtLk3/OlnpgangaB" +
    "clYpsYBr5i+4ynB07ceb3LP0OIOZdxexX69c5iVuyJRQ+Hz05yi+UF3uBWAlHpiS5sh0+H2G" +
    "HE7SXrk1EC5m1Tr19L9gg92jYzBhMA4GA1UdDwEB/wQEAwIBBjAPBgNVHRMBAf8EBTADAQH/" +
    "MB0GA1UdDgQWBBRYwB5fkUWlZql6zJChkyLQKsXF+jAfBgNVHSMEGDAWgBRYwB5fkUWlZql6" +
    "zJChkyLQKsXF+jAKBggqhkjOPQQDAwNpADBmAjEAj1nHeXZp+13NWBNa+EDsDP8G1WWg1tCM" +
    "WP/WHPqpaVo0jhsweNFZgSs0eE7wYI4qAjEA2WB9ot98sIkoF3vZYdd3/VtWB5b9TNMea7Ix" +
    "/stJ5TfcLLeABLE4BNJOsQ4vnBHJ",
);

/** `O=sigstore.dev, CN=sigstore-intermediate` — what issues signing certificates. */
export const FULCIO_INTERMEDIATE_DER: Uint8Array = decodeBase64(
  "MIICGjCCAaGgAwIBAgIUALnViVfnU0brJasmRkHrn/UnfaQwCgYIKoZIzj0EAwMwKjEVMBMG" +
    "A1UEChMMc2lnc3RvcmUuZGV2MREwDwYDVQQDEwhzaWdzdG9yZTAeFw0yMjA0MTMyMDA2MTVa" +
    "Fw0zMTEwMDUxMzU2NThaMDcxFTATBgNVBAoTDHNpZ3N0b3JlLmRldjEeMBwGA1UEAxMVc2ln" +
    "c3RvcmUtaW50ZXJtZWRpYXRlMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAE8RVS/ysH+NOvuDZy" +
    "PIZtilgUF9NlarYpAd9HP1vBBH1U5CV77LSS7s0ZiH4nE7Hv7ptS6LvvR/STk798LVgMzLlJ" +
    "4HeIfF3tHSaexLcYpSASr1kS0N/RgBJz/9jWCiXno3sweTAOBgNVHQ8BAf8EBAMCAQYwEwYD" +
    "VR0lBAwwCgYIKwYBBQUHAwMwEgYDVR0TAQH/BAgwBgEB/wIBADAdBgNVHQ4EFgQU39Ppz1Yk" +
    "EZb5qNjpKFWixi4YZD8wHwYDVR0jBBgwFoAUWMAeX5FFpWapesyQoZMi0CrFxfowCgYIKoZI" +
    "zj0EAwMDZwAwZAIwPCsQK4DYiZYDPIaDi5HFKnfxXx6ASSVmERfsynYBiX2X6SJRnZU84/9D" +
    "ZdnFvvxmAjBOt6QpBlc4J/0DxvkTCqpclvziL6BCCPnjdlIB3Pu3BxsPmygUY7Ii2zbdCdli" +
    "iow=",
);

/** The OIDC issuer Fulcio records for a GitHub Actions workflow. */
export const GITHUB_ACTIONS_OIDC_ISSUER = "https://token.actions.githubusercontent.com";

/** The workflow that is allowed to sign a Specnaut release. */
export const RELEASE_WORKFLOW_PATH = ".github/workflows/release.yml";

/**
 * The exact identity the signing certificate must carry for `version`.
 *
 * Bound to the **specific tag**, not just to the repository. A pattern over
 * `refs/tags/v*` would accept a bundle lifted from any other release of this
 * same repository; pinning the version being installed means a replayed bundle
 * fails on identity before the digest check is reached.
 */
export function expectedSignerIdentity(version: string): string {
  return `https://github.com/${RELEASE_REPO}/${RELEASE_WORKFLOW_PATH}@refs/tags/v${version}`;
}

/** The release asset carrying the Sigstore bundle. */
export const ATTESTATION_ASSET_NAME = "specnaut.attestation.sigstore.json";

/**
 * The first release signed this way.
 *
 * Below it a release legitimately has no bundle, and refusing would strand
 * every user on an older version. At or above it a missing bundle is a failure.
 * The transition has to be a stated version rather than "warn if absent"
 * forever, or the gate never actually closes.
 */
export const FIRST_SIGNED_VERSION = "4.3.0";
