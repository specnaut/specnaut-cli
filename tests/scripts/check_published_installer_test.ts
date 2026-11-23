import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { bash, linkTools, writeExecutable } from "./install_sh_sandbox.ts";

/**
 * cli#817 — `postflight.sh` runs the published installer through
 * `.specnaut/release/check-published-installer.sh`: staged for the tag, installing it on a
 * verified attestation, and refusing a tampered binary whose checksum matches. A fake installer
 * stands in for the published one and behaves as each case says. PATH holds only the stubs and
 * links to the tools the check uses, so a runner's own gh is never reached.
 */

const SCRIPT = fromFileUrl(
  new URL("../../.specnaut/release/check-published-installer.sh", import.meta.url),
);
const TAG = "v9.9.9";
const ID =
  `https://github.com/specnaut/specnaut-cli/.github/workflows/release.yml@refs/tags/${TAG}`;
const ignore = Deno.build.os === "windows";
const TOOLS = [
  ...["env", "grep", "awk", "mktemp", "rm", "mkdir", "tail", "cat", "chmod", "cp", "bash", "sh"],
  ...["shasum", "sha256sum", "cmp"],
];

type Fake = {
  baked?: string;
  marker?: boolean;
  version?: string;
  /** How a tampered binary is met: refused on its attestation, on its checksum, or installed. */
  tampered?: "attestation" | "checksum" | "installed";
  gh?: boolean;
};

/** The release's URLs, as install.sh spells them: every one holds `/specnaut-cli/`. */
const RELEASE = `https://github.com/specnaut/specnaut-cli/releases/download/${TAG}`;

/**
 * An installer that downloads the binary, its checksum and the bundle through curl, and judges
 * them as `f` says. A bundle that does not arrive byte for byte is its own refusal: the tampered
 * run must be refused for the binary, never for a bundle the check itself broke.
 */
const installer = (dir: string, f: Fake) =>
  `#!/bin/bash
${f.baked ?? `RELEASE_TAG='${TAG}'`}
set -e
[ "$REQUIRE_ATTESTATION" = 1 ] && [ -z "\${SPECNAUT_VERSION:-}" ] || { echo "steered"; exit 9; }
curl -fsSL ${RELEASE}/specnaut-linux-x64 -o "$PREFIX.dl"
curl -fsSL ${RELEASE}/specnaut-linux-x64.sha256 -o "$PREFIX.sha"
curl -fsSL ${RELEASE}/specnaut.attestation.sigstore.json -o "$PREFIX.bundle"
cmp -s "$PREFIX.bundle" '${dir}/bundle' || { echo "error: the bundle arrived altered"; exit 1; }
if ! cmp -s "$PREFIX.dl" '${dir}/published'; then
  case '${f.tampered ?? "attestation"}' in
    attestation) echo "error: gh refused the attestation for ${TAG} (reason above)"; exit 1 ;;
    checksum) echo "error: checksum mismatch"; exit 1 ;;
  esac
fi
${f.marker === false ? "" : `echo "  ok attestation verified for ${ID}"`}
mkdir -p "$PREFIX" && cp "$PREFIX.dl" "$PREFIX/specnaut" && chmod 755 "$PREFIX/specnaut"
`;

/** curl serving the installer, the published binary and a checksum from `dir`. */
const curl = (dir: string) =>
  `#!/bin/sh
out="" prev="" url=""
for a in "$@"; do [ "$prev" = -o ] && out=$a; case $a in https://*) url=$a ;; esac; prev=$a; done
case \${url##*/} in install.sh) f=install.sh ;; *.sha256) f=published.sha ;; *.sigstore.json) f=bundle ;; specnaut-*) f=published ;; *) exit 22 ;; esac
cp '${dir}/'$f "$out"
`;

/** The stubs and the files they serve, in `dir`; returns the folder that is the whole PATH. */
async function world(dir: string, f: Fake): Promise<string> {
  const bin = join(dir, "bin");
  await Deno.mkdir(bin);
  await writeExecutable(
    join(dir, "published"),
    `#!/bin/sh\necho "specnaut ${f.version ?? "9.9.9"}"\n`,
  );
  await Deno.writeTextFile(join(dir, "published.sha"), "0  specnaut\n");
  await Deno.writeTextFile(join(dir, "bundle"), '{"fake": "bundle"}\n');
  await Deno.writeTextFile(join(dir, "install.sh"), installer(dir, f));
  await writeExecutable(join(bin, "curl"), curl(dir));
  const gh = f.gh === false ? "exit 1" : '[ "$*" = "attestation verify --help" ]';
  await writeExecutable(join(bin, "gh"), `#!/bin/sh\n${gh}\n`);
  await linkTools(bin, TOOLS);
  return bin;
}

async function check(f: Fake = {}) {
  const dir = await Deno.makeTempDir({ prefix: "check-installer-" });
  try {
    const PATH = await world(dir, f);
    const env = {
      PATH,
      HOME: dir,
      SPECNAUT_VERSION: "v1.0.0",
      CHECK_INSTALLER_URL: "https://x/install.sh",
    };
    return await bash([SCRIPT, TAG], env);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const test = (name: string, fn: () => Promise<void>) => Deno.test({ name, ignore, fn });

test("passes on an installer that verifies, and refuses the tampered binary", async () => {
  const r = await check();
  assertEquals(r.code, 0, r.out);
  assertStringIncludes(r.out, `ok published installer: installs ${TAG}`);
});

for (
  const [name, fake, reason] of [
    ["not staged for the tag", { baked: "RELEASE_TAG='v1.0.0'" }, "it is not staged for v9.9.9"],
    [
      "still carrying the placeholder",
      { baked: `RELEASE_TAG='${TAG}'\n# __SPECNAUT_RELEASE_TAG__` },
      "it still carries the placeholder",
    ],
    ["silent about the attestation", { marker: false }, `it never said: attestation verified`],
    ["placing another version", { version: "1.0.0" }, "reports '1.0.0', not v9.9.9"],
    ["installing a tampered binary", { tampered: "installed" }, "it installed a tampered binary"],
    ["refusing it on the checksum", { tampered: "checksum" }, "but not on its attestation"],
  ] as Array<[string, Fake, string]>
) {
  test(`fails on an installer ${name}`, async () => {
    const r = await check(fake);
    assertEquals(r.code, 1, r.out);
    assertStringIncludes(r.out, reason);
  });
}

test("a gh without `attestation` is a named skip, never a pass", async () => {
  const r = await check({ gh: false });
  assertEquals(r.code, 3, r.out);
  assertStringIncludes(r.out, "SKIPPED published installer");
  assert(!r.out.includes("ok published installer"), r.out);
});

/** postflight.sh's block that runs this check, with a fake check exiting `code`. */
async function postflightBlock(code: number) {
  const src = (await Deno.readTextFile(SCRIPT.replace("check-published-installer", "postflight")))
    .replaceAll("\r\n", "\n");
  const m = src.match(/# BEGIN installer-check\n([\s\S]*?)# END installer-check/);
  assert(m, "postflight.sh has no installer-check block");
  const dir = await Deno.makeTempDir({ prefix: "postflight-installer-" });
  try {
    await Deno.mkdir(join(dir, ".specnaut/release"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".specnaut/release/check-published-installer.sh"),
      `exit ${code}\n`,
    );
    const script = `set -euo pipefail\nTAG=${TAG}\n${m[1]}\necho "skipped=$installer_skipped"\n`;
    return await bash(["-c", script], { PATH: "/usr/bin:/bin" }, dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

test("postflight goes on after a pass, records a skip, and fails hard on anything else", async () => {
  assertEquals(await postflightBlock(0), {
    code: 0,
    out: "> running the published installer\nskipped=0\n",
  });
  assertStringIncludes((await postflightBlock(3)).out, "skipped=1");
  const failed = await postflightBlock(1);
  assertEquals(failed.code, 1, failed.out);
  assertStringIncludes(failed.out, "FAIL the published install.sh does not install v9.9.9");
});
