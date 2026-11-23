import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/**
 * cli#696 — `pretag.sh` runs the upgrade smoke on a locally compiled binary
 * after the bump and before the tag, so a broken `upgrade` blocks the tag
 * instead of shipping and needing a patch. Its exit codes must mean what they
 * mean in postflight: 1 blocks, 3 and 4 are named skips that never read as a
 * pass. A fake smoke stands in for `smoke-upgrade.sh` and exits with the code
 * a case needs; the binary is handed in, so nothing is compiled here.
 *
 * cli#817 — before the smoke, the tree's install.sh must install the previous release on its
 * attestation. A fake installer stands in for it, so no case reaches the network or a real gh.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SCRIPT = `${ROOT}.specnaut/release/pretag.sh`;
const TAG = "v9.9.9";
const MARKER =
  "attestation verified for https://github.com/specnaut/specnaut-cli/.github/workflows/release.yml@refs/tags/v9.9.8";

// The release operator's script, run from a macOS or Linux shell.
const ignore = Deno.build.os === "windows";

/** The installer: records the variables it was given, then prints `say` and exits `code`. */
const installer = (dir: string, say: string, code: number) =>
  `echo "$REQUIRE_ATTESTATION \${VERSION-unset} \${SPECNAUT_VERSION-unset} \${REPO-unset}" > "${dir}/inst-env"
echo "${say}"
exit ${code}
`;

async function run(
  smokeExit: number,
  args: string[] = [TAG, "bin/specnaut"],
  inst: { say: string; code: number } = { say: MARKER, code: 0 },
) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-pretag-" });
  try {
    await Deno.mkdir(join(dir, "bin"));
    const bin = join(dir, "bin", "specnaut");
    await Deno.writeTextFile(bin, "#!/usr/bin/env bash\nexit 0\n");
    await Deno.chmod(bin, 0o755);
    const smoke = join(dir, "smoke.sh");
    await Deno.writeTextFile(smoke, `echo "$@" > "${dir}/smoke-args"\nexit ${smokeExit}\n`);
    const fake = join(dir, "install.sh");
    await Deno.writeTextFile(fake, installer(dir, inst.say, inst.code));
    const out = await new Deno.Command("bash", {
      args: [SCRIPT, ...args],
      cwd: dir,
      env: { PRETAG_SMOKE: smoke, PRETAG_INSTALLER: fake, VERSION: "v1.0.0", REPO: "a/b" },
    }).output();
    const dec = new TextDecoder();
    const smokeArgs = await Deno.readTextFile(join(dir, "smoke-args")).then(
      (t) => t.trim(),
      () => "",
    );
    return {
      code: out.code,
      out: dec.decode(out.stdout) + dec.decode(out.stderr),
      smokeArgs,
      instEnv: await Deno.readTextFile(join(dir, "inst-env")).then((t) => t.trim(), () => ""),
      bin: await Deno.realPath(bin),
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("passes the tag and an ABSOLUTE binary path to the smoke", { ignore }, async () => {
  const r = await run(0);
  assertEquals(r.code, 0, r.out);
  assertEquals(r.smokeArgs, `${TAG} ${r.bin}`);
  assertStringIncludes(r.out, "✓ pre-tag upgrade smoke passed");
});

Deno.test("exit 1 from the smoke blocks the tag", { ignore }, async () => {
  const r = await run(1);
  assertEquals(r.code, 1, r.out);
  assertStringIncludes(r.out, `do NOT tag ${TAG}`);
});

for (
  const [rc, reason] of [
    [3, "no release was published before v9.9.9"],
    [4, "the previous release's project could not be prepared"],
  ] as Array<[number, string]>
) {
  Deno.test(
    `exit ${rc} is a named skip with the re-run command, never a pass`,
    { ignore },
    async () => {
      const r = await run(rc);
      assertEquals(r.code, rc, r.out);
      assertStringIncludes(r.out, `SKIPPED — ${reason}`);
      assertStringIncludes(r.out, `bash .specnaut/release/smoke-upgrade.sh ${TAG} ${r.bin}`);
      assert(!r.out.includes("passed"), r.out);
    },
  );
}

Deno.test("any other smoke exit blocks the tag too", { ignore }, async () => {
  const r = await run(2);
  assertEquals(r.code, 1, r.out);
  assertStringIncludes(r.out, `do NOT tag ${TAG}`);
});

Deno.test(
  "refuses without a tag, or with a binary that is not executable",
  { ignore },
  async () => {
    const none = await run(0, []);
    assertEquals(none.code, 2, none.out);
    const missing = await run(0, [TAG, "bin/nope"]);
    assertEquals(missing.code, 2, missing.out);
    assertEquals(missing.smokeArgs, "", "the smoke must not run on a binary that is not there");
  },
);

Deno.test(
  "the installer runs unpinned, attestation required, before the smoke",
  { ignore },
  async () => {
    const r = await run(0);
    assertEquals(r.code, 0, r.out);
    assertEquals(r.instEnv, "1 unset unset unset");
    assertStringIncludes(r.out, "ok install.sh verified the previous release's attestation");
  },
);

for (
  const [name, inst] of [
    ["fails", { say: MARKER, code: 1 }],
    ["never says it verified the attestation", { say: "checksum verified", code: 0 }],
  ] as Array<[string, { say: string; code: number }]>
) {
  Deno.test(`an installer that ${name} blocks the tag, smoke or not`, { ignore }, async () => {
    const r = await run(0, [TAG, "bin/specnaut"], inst);
    assertEquals(r.code, 1, r.out);
    assertStringIncludes(r.out, `on its attestation - do NOT tag ${TAG}`);
    assertEquals(r.smokeArgs, "", "the smoke ran after the installer check failed");
  });
}
