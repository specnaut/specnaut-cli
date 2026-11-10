import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/**
 * postflight.sh's check of the PUBLISHED macOS assets (cli#428): it runs
 * `scripts/release/check-macos-signature.sh` on each, with the team and the
 * identifier read from release.yml's `env:`, the one place they are written.
 * A failure is HARD, like the attestation's: an unsigned binary re-prompts
 * every macOS user. Without `codesign` it says it skipped, never that it passed.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const ignore = Deno.build.os === "windows";

async function block(): Promise<string> {
  const src = (await Deno.readTextFile(`${ROOT}.specnaut/release/postflight.sh`))
    .replaceAll("\r\n", "\n");
  const m = src.match(/# BEGIN macos-signature-check\n([\s\S]*?)# END macos-signature-check/);
  assert(m, "postflight.sh has no macos-signature-check block");
  return m[1];
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

/** The published assets, and a `codesign` that accepts only `team` — or none at all. */
async function world(dir: string, team: string | null, assets: string[]): Promise<string> {
  await Deno.mkdir(join(dir, "assets"));
  for (const f of [...assets, "specnaut-linux-x64"]) {
    await Deno.writeTextFile(join(dir, "assets", f), "");
  }
  if (team === null) return "/nonexistent:/bin";
  await Deno.writeTextFile(
    join(dir, "codesign"),
    `#!/bin/bash\ncase "$1" in --verify) [[ "$4" == *'= "${team}" and identifier "com.specnaut.cli"' ]] ;; -d) echo 'designated => identifier "com.specnaut.cli" and certificate leaf[subject.OU] = ${team}' >&2 ;; esac\n`,
  );
  await Deno.chmod(join(dir, "codesign"), 0o755);
  return `${dir}:/bin`;
}

/** Runs the postflight block from the repository root, as postflight itself runs. */
async function postflight(codesign: "ours" | "theirs" | null, assets = ["specnaut-macos-arm64"]) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-428-postflight-" });
  try {
    const team = codesign === null ? null : codesign === "ours" ? "H87Y8Z6YPS" : "ZZZZZZZZZZ";
    const PATH = await world(dir, team, assets);
    const script = `set -euo pipefail\nverify_tmp=${join(dir, "assets")}\n${await block()}\n` +
      `echo "skipped=$macsig_skipped"`;
    return await bashIn(["-c", script], ROOT, { PATH });
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

Deno.test({
  name: "postflight: a published binary signed for release.yml's identity passes",
  ignore,
}, async () => {
  const r = await postflight("ours");
  assertEquals(r.code, 0, r.out);
  assertStringIncludes(r.out, "OK specnaut-macos-arm64: Developer ID Application of H87Y8Z6YPS");
  assertStringIncludes(r.out, "skipped=0");
});

Deno.test(
  { name: "postflight: another team's signature fails hard, naming the clause", ignore },
  async () => {
    const r = await postflight("theirs");
    assertEquals(r.code, 1, r.out);
    assertStringIncludes(
      r.out,
      "FAIL specnaut-macos-arm64: does not verify as a Developer ID Application",
    );
    assertStringIncludes(r.out, "❌ specnaut-macos-arm64");
  },
);

Deno.test({ name: "postflight: no macOS asset at all fails hard", ignore }, async () => {
  const r = await postflight("ours", []);
  assertEquals(r.code, 1, r.out);
  assertStringIncludes(r.out, "❌ no macOS binary among the published assets");
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
