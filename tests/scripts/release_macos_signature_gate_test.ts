import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse } from "@std/yaml";

/**
 * The two checks that a published macOS binary carries the Developer ID
 * signature (cli#428), run against stubbed signing tools.
 *
 * `build` reads each macOS binary with `rcodesign` on Linux before it attests
 * anything: in the canonical repository an unsigned binary fails the release,
 * because the attestation and checksums would otherwise bless it; in a fork it
 * passes with a warning. `postflight.sh` reads the PUBLISHED assets with
 * Apple's `codesign`. The designated requirement must name the identifier and
 * the Team ID, never a cdhash: a cdhash requirement is the ad-hoc signature
 * that made the Keychain forget "Always Allow" on every update.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const ignore = Deno.build.os === "windows"; // bash stubs, as in postflight_catalog_test.ts
const TEAM = "H87Y8Z6YPS";

const SIGNED_INFO = `        code_requirements:
        - 'designated(3): 0: (identifier "com.specnaut.cli") and ((anchor apple generic) and ((certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */) and ((certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */) and (certificate leaf[subject.OU] = "${TEAM}"))));'
        cms:
          certificates:
          - subject: CN=Developer ID Certification Authority, OU=Apple Certification Authority, O=Apple Inc., C=US
          - subject: 'CN=Developer ID Application: Example Maintainer (${TEAM}), OU=${TEAM}, O=Example, C=US'
`;
const ADHOC_INFO = `        code_directory:
          flags: CodeSignatureFlags(ADHOC | LINKER_SIGNED)
          identifier: a.out
        cms: null
`;

async function stubbed<T>(
  tools: Record<string, string>,
  fn: (dir: string, path: string) => Promise<T>,
): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-428-" });
  try {
    await Deno.mkdir(join(dir, "bin"));
    for (const [name, body] of Object.entries(tools)) {
      await Deno.writeTextFile(join(dir, "bin", name), `#!/usr/bin/env bash\n${body}\n`);
      await Deno.chmod(join(dir, "bin", name), 0o755);
    }
    return await fn(dir, `${join(dir, "bin")}:/usr/bin:/bin`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

async function bash(script: string, cwd: string, env: Record<string, string>) {
  const { code, stdout, stderr } = await new Deno.Command("bash", {
    args: ["-c", script],
    cwd,
    env,
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { code, out: new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr) };
}

// ── build: rcodesign on the signed set, before attest ───────────────────────

async function buildGate(info: string, canonical: boolean, macos = "x64 arm64") {
  const wf = parse(await Deno.readTextFile(`${ROOT}.github/workflows/release.yml`)) as {
    env: Record<string, string>;
    jobs: Record<string, { steps?: { name?: string; run?: string }[] }>;
  };
  const steps = wf.jobs.build.steps ?? [];
  const at = steps.findIndex((s) => /rcodesign print-signature-info/.test(s.run ?? ""));
  assert(at >= 0, "build does not read the macOS signatures");
  assert(at < steps.findIndex((s) => s.name === "Attest build provenance"), "checked after attest");
  const json = JSON.stringify(
    macos.split(" ").filter(Boolean).map((a) => ({ outName: `specnaut-macos-${a}` })),
  );
  return await stubbed(
    { rcodesign: `cat <<'EOF'\n${info}EOF` },
    (dir, path) =>
      bash(steps[at].run!, dir, {
        PATH: path,
        MACOS_JSON: json,
        CANONICAL: String(canonical),
        MACOS_TEAM_ID: wf.env.MACOS_TEAM_ID,
        MACOS_IDENTIFIER: wf.env.MACOS_IDENTIFIER,
      }),
  );
}

Deno.test({ name: "build: a Developer ID signature naming the team passes", ignore }, async () => {
  const r = await buildGate(SIGNED_INFO, true);
  assertEquals(r.code, 0, r.out);
  assertStringIncludes(r.out, `specnaut-macos-arm64: Developer ID (${TEAM})`);
});

Deno.test(
  { name: "build: the canonical repository refuses an unsigned macOS binary", ignore },
  async () => {
    const r = await buildGate(ADHOC_INFO, true);
    assertEquals(r.code, 1, r.out);
    assertStringIncludes(r.out, "::error::specnaut-macos-x64");
  },
);

Deno.test({ name: "build: another team's signature is refused", ignore }, async () => {
  const r = await buildGate(SIGNED_INFO.replaceAll(TEAM, "ZZZZZZZZZZ"), true);
  assertEquals(r.code, 1, r.out);
});

Deno.test(
  { name: "build: a fork passes unsigned binaries through, with a warning", ignore },
  async () => {
    const r = await buildGate(ADHOC_INFO, false);
    assertEquals(r.code, 0, r.out);
    assertStringIncludes(r.out, "::warning::specnaut-macos-x64");
  },
);

Deno.test(
  { name: "build: an empty macOS target list is a failure, not a pass", ignore },
  async () => {
    const r = await buildGate(SIGNED_INFO, true, "");
    assertEquals(r.code, 1, r.out);
  },
);

// ── postflight: Apple's codesign on the published assets ─────────────────────

async function postflight(dr: string | null, verify = 0) {
  const src = (await Deno.readTextFile(`${ROOT}.specnaut/release/postflight.sh`))
    .replaceAll("\r\n", "\n");
  const m = src.match(/# BEGIN macos-signature-check\n([\s\S]*?)# END macos-signature-check/);
  assert(m, "postflight.sh has no macos-signature-check block");
  const tools: Record<string, string> = dr === null ? {} : {
    codesign: `case "$1" in --verify) exit ${verify} ;; -d) echo 'designated => ${dr}' >&2 ;; esac`,
  };
  return await stubbed(tools, async (dir, path) => {
    const assets = join(dir, "assets");
    await Deno.mkdir(assets);
    for (const f of ["specnaut-macos-arm64", "specnaut-macos-arm64.sha256", "specnaut-linux-x64"]) {
      await Deno.writeTextFile(join(assets, f), "");
    }
    // `codesign` must come from the stub dir alone, or a real macOS host's
    // binary answers instead of the stub; `rm` is in /bin.
    const p = dr === null ? "/nonexistent:/bin" : path.replace(":/usr/bin", "");
    return await bash(
      `set -euo pipefail\nverify_tmp=${assets}\n${m[1]}\necho "skipped=$macsig_skipped"`,
      dir,
      { PATH: p },
    );
  });
}

const GOOD_DR =
  `identifier "com.specnaut.cli" and anchor apple generic and certificate leaf[subject.OU] = ${TEAM}`;

Deno.test(
  { name: "postflight: a published binary with the team's requirement passes", ignore },
  async () => {
    const r = await postflight(GOOD_DR);
    assertEquals(r.code, 0, r.out);
    assertStringIncludes(r.out, "specnaut-macos-arm64: valid");
    assertStringIncludes(r.out, "skipped=0");
  },
);

Deno.test({ name: "postflight: an ad-hoc (cdhash) requirement fails hard", ignore }, async () => {
  const r = await postflight(`cdhash H"0123456789abcdef0123456789abcdef01234567"`);
  assertEquals(r.code, 1, r.out);
  assertStringIncludes(r.out, "❌");
});

Deno.test({ name: "postflight: a signature that does not verify fails hard", ignore }, async () => {
  const r = await postflight(GOOD_DR, 1);
  assertEquals(r.code, 1, r.out);
});

Deno.test(
  { name: "postflight: without codesign the check says it was skipped", ignore },
  async () => {
    const r = await postflight(null);
    assertEquals(r.code, 0, r.out);
    assertStringIncludes(r.out, "NOT checked");
    assertStringIncludes(r.out, "skipped=1");
  },
);
