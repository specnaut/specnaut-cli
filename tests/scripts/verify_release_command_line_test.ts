import { assertEquals } from "@std/assert";
import { parseCommandLine } from "../../scripts/verify-release.ts";
import { expectedSignerIdentity } from "../../src/domain/sigstore/trust_anchor.ts";

/**
 * The release check answers one question: does every published binary verify against the identity
 * of the release workflow at this tag. The identity is derived from `--tag`, never passed in, so no
 * argument can make a certificate from another workflow or ref stand in for a release's.
 */

Deno.test("the identity is release.yml's at the tag, derived and never passed in", () => {
  assertEquals(parseCommandLine(["--tag", "v1.2.3", "--dir", "d"]), {
    dir: "d",
    tag: "v1.2.3",
    identity: expectedSignerIdentity("1.2.3"),
  });
});

Deno.test("the command line needs both a tag and a directory", () => {
  assertEquals(parseCommandLine(["--tag", "v1.2.3"]), null);
  assertEquals(parseCommandLine(["--dir", "d"]), null);
  assertEquals(parseCommandLine([]), null);
});

Deno.test("no flag names another identity: a ref beside the tag leaves the tag's identity", () => {
  const parsed = parseCommandLine([
    "--tag",
    "v1.2.3",
    "--dry-run-ref",
    "refs/heads/main",
    "--dir",
    "d",
  ]);
  assertEquals(parsed?.identity, expectedSignerIdentity("1.2.3"));
});
