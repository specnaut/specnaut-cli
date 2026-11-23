import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import {
  INSTALLER_ASSET_NAME,
  INSTALLER_ATTESTATION_ASSET_NAME,
} from "../../scripts/release/attestation-bundles.ts";

/**
 * SECURITY.md tells a user how to verify the installer before running it. Pasted into a shell,
 * independent lines run whatever the line before did, so a refused attestation would still run
 * the script: each step must be chained on the one before. And the check it asks gh for must be
 * the one install.sh asks gh for, against the installer's own bundle.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SECURITY = Deno.readTextFileSync(`${ROOT}SECURITY.md`);
const INSTALL = Deno.readTextFileSync(`${ROOT}install.sh`);

/** The recipe's commands after the two assignments, one per entry, continuations joined. */
function recipe(): string[] {
  const section = SECURITY.slice(SECURITY.indexOf("## What `install.sh` checks"));
  const block = section.match(/```sh\n([\s\S]*?)```/)?.[1];
  assert(block, "SECURITY.md no longer shows how to verify install.sh");
  const lines = block.replace(/\\\n\s*/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  assert(lines[0].startsWith("tag=") && lines[1].startsWith("base="), lines.join("\n"));
  return lines.slice(2);
}

/** `--flag value` pairs of a command line, quotes removed; a flag without a value maps to "". */
function flags(command: string): Map<string, string> {
  const words = command.split(/\s+/).map((w) => w.replace(/^"|"$/g, ""));
  const out = new Map<string, string>();
  words.forEach((w, i) => {
    if (!w.startsWith("--")) return;
    const next = words[i + 1] ?? "";
    out.set(w, next.startsWith("--") || next === "&&" ? "" : next);
  });
  return out;
}

/** install.sh's own gh invocation in verify_attestation, its variables written out. */
function installShFlags(): Map<string, string> {
  const fn = INSTALL.slice(INSTALL.indexOf("verify_attestation() {"));
  const gh = fn.slice(fn.indexOf("gh attestation verify"), fn.indexOf(">"));
  const value = (name: string) => INSTALL.match(new RegExp(`^${name}="([^"]+)"`, "m"))![1];
  const identity = INSTALL.match(/^signer_identity\(\) \{ printf '([^']+)'/m)![1]
    .replace("%s", value("SIGNER_REPO")).replace("%s", "$tag");
  return new Map([...flags(gh.replace(/\\\n\s*/g, ""))].map(([k, v]) => {
    const resolved = v.replace("$SIGNER_REPO", value("SIGNER_REPO"))
      .replace("$SIGNER_ISSUER", value("SIGNER_ISSUER")).replace("$(signer_identity)", identity);
    return [k, k === "--bundle" ? INSTALLER_ATTESTATION_ASSET_NAME : resolved];
  }));
}

Deno.test("SECURITY.md runs install.sh only after its attestation verified", () => {
  const steps = recipe();
  assertEquals(steps.length, 4, steps.join("\n"));
  steps.slice(0, -1).forEach((s) => assert(s.endsWith(" &&"), `not chained: ${s}`));
  assert(steps[0].startsWith("curl ") && steps[0].includes(`/${INSTALLER_ASSET_NAME}"`));
  assert(
    steps[1].startsWith("curl ") && steps[1].includes(`/${INSTALLER_ATTESTATION_ASSET_NAME}"`),
  );
  assert(steps[2].startsWith(`gh attestation verify ${INSTALLER_ASSET_NAME} `), steps[2]);
  assertEquals(steps[3], `REQUIRE_ATTESTATION=1 bash ${INSTALLER_ASSET_NAME}`);
});

Deno.test("SECURITY.md asks gh for the check install.sh makes, on the installer's bundle", () => {
  const want = installShFlags();
  assertEquals([...want.keys()].sort(), [
    "--bundle",
    "--cert-identity",
    "--cert-oidc-issuer",
    "--deny-self-hosted-runners",
    "--repo",
  ]);
  assertEquals(flags(recipe()[2]), want);
});
