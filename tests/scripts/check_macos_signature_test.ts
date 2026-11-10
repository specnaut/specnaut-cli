import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse } from "@std/yaml";

/**
 * `scripts/release/check-macos-signature.sh`, the one check that a macOS
 * binary is ours (cli#428), shared by release.yml's macos-smoke and by
 * postflight.sh.
 *
 * It asks Apple's `codesign` to verify the binary against an explicit
 * requirement — Apple anchor, Developer ID intermediate, Developer ID
 * Application leaf, the team, the identifier — so the chain is verified, not
 * read. Then the binary's own designated requirement must name the identifier
 * and team and pin no cdhash: a cdhash requirement is the ad-hoc signature that
 * made the Keychain forget "Always Allow" on every update.
 *
 * The clause tests stub `codesign` and assert the line naming the failed
 * clause; on macOS the real `codesign` refuses an Apple-signed and an ad-hoc
 * binary at the first clause.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SCRIPT = `${ROOT}scripts/release/check-macos-signature.sh`;
const ignore = Deno.build.os === "windows";
const TEAM = "H87Y8Z6YPS";
const ID = "com.specnaut.cli";
const REQUIREMENT =
  `=anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "${TEAM}" and identifier "${ID}"`;
const GOOD_DR =
  `identifier "${ID}" and anchor apple generic and certificate leaf[subject.OU] = ${TEAM}`;

/** A `codesign` that verifies only the exact requirement, when told the signature holds. */
function codesignStub(verifies: boolean, dr: string): string {
  return `#!/bin/bash
case "$1" in
  --verify) [ "$2 $3" = "--strict -R" ] && [ "$4" = '${REQUIREMENT}' ] && ${verifies} ;;
  -d) echo 'designated => ${dr}' >&2 ;;
  *) exit 64 ;;
esac`;
}

/** Runs /bin/bash with exactly `env`, returning its exit code and combined output. */
async function bashIn(args: string[], cwd: string, env: Record<string, string>) {
  const r = await new Deno.Command("/bin/bash", {
    args,
    cwd,
    env,
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: r.code,
    out: new TextDecoder().decode(r.stdout) + new TextDecoder().decode(r.stderr),
  };
}

async function run(args: string[], stub: string | null, cwd = ROOT) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-428-check-" });
  try {
    if (stub) {
      await Deno.writeTextFile(join(dir, "codesign"), stub);
      await Deno.chmod(join(dir, "codesign"), 0o755);
    }
    return await bashIn(args, cwd, { PATH: stub ? dir : "/usr/bin:/bin" });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const check = (verifies: boolean, dr: string) =>
  run([SCRIPT, TEAM, ID, "/tmp/specnaut-macos-arm64"], codesignStub(verifies, dr));

Deno.test({ name: "check: the full requirement and a team requirement pass", ignore }, async () => {
  const r = await check(true, GOOD_DR);
  assertEquals(r.code, 0, r.out);
  assertStringIncludes(r.out, `OK specnaut-macos-arm64: Developer ID Application of ${TEAM}`);
});

Deno.test({ name: "check: a signature failing the requirement is named", ignore }, async () => {
  const r = await check(false, GOOD_DR);
  assertEquals(r.code, 1, r.out);
  assertStringIncludes(
    r.out,
    `FAIL specnaut-macos-arm64: does not verify as a Developer ID Application of ${TEAM}`,
  );
});

Deno.test({
  name: "check: the full requirement with a cdhash designated requirement fails",
  ignore,
}, async () => {
  const r = await check(true, `cdhash H"0123456789abcdef0123456789abcdef01234567"`);
  assertEquals(r.code, 1, r.out);
  assertStringIncludes(
    r.out,
    "FAIL specnaut-macos-arm64: its designated requirement pins a cdhash",
  );
});

Deno.test(
  { name: "check: a designated requirement naming another identifier fails", ignore },
  async () => {
    const r = await check(true, GOOD_DR.replace(ID, "com.example.other"));
    assertEquals(r.code, 1, r.out);
    assertStringIncludes(r.out, `its designated requirement does not name ${ID} and ${TEAM}`);
  },
);

Deno.test({
  name: "check: Apple's codesign refuses an ad-hoc binary at the first clause",
  ignore: Deno.build.os !== "darwin",
}, async () => {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-428-adhoc-" });
  try {
    await Deno.copyFile("/bin/echo", join(dir, "specnaut-macos-arm64"));
    const sign = await new Deno.Command("/usr/bin/codesign", {
      args: ["-f", "-s", "-", join(dir, "specnaut-macos-arm64")],
    }).output();
    assert(sign.success, "could not ad-hoc sign the copy");
    const r = await run([SCRIPT, TEAM, ID, join(dir, "specnaut-macos-arm64")], null);
    assertEquals(r.code, 1, r.out);
    assertStringIncludes(
      r.out,
      "FAIL specnaut-macos-arm64: does not verify as a Developer ID Application",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("macos-smoke runs the check with the workflow's identity", async () => {
  const wf = parse(await Deno.readTextFile(`${ROOT}.github/workflows/release.yml`)) as {
    jobs: Record<string, { steps?: { run?: string }[] }>;
  };
  const runs = (wf.jobs["macos-smoke"].steps ?? []).map((s) => s.run ?? "").join("\n");
  assertStringIncludes(
    runs,
    'bash scripts/release/check-macos-signature.sh "$MACOS_TEAM_ID" "$MACOS_IDENTIFIER" "$BIN"',
  );
});

Deno.test("postflight names no team and no identifier of its own", async () => {
  const postflight = await Deno.readTextFile(`${ROOT}.specnaut/release/postflight.sh`);
  assert(!postflight.includes(TEAM) && !postflight.includes(ID), "a second home for the identity");
  assertStringIncludes(postflight, "scripts/release/check-macos-signature.sh");
});
