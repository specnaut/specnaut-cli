import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { INSTALL, PLACEHOLDER, staged } from "./install_sh_sandbox.ts";

/**
 * cli#817 — `scripts/release/stage-installer.sh` writes the tag into the copy of install.sh a
 * release publishes and attests. The tag is checked first: the run's own tag, deno.json's version,
 * a version install.sh accepts. The placeholder must occur once, and the copy must parse.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SCRIPT = `${ROOT}scripts/release/stage-installer.sh`;
const VERSION = JSON.parse(await Deno.readTextFile(`${ROOT}deno.json`)).version as string;
const TAG = `v${VERSION}`;
const ignore = Deno.build.os === "windows"; // runs on the release's Linux runner

async function stage(tag: string, opts: { ref?: string; source?: string } = {}) {
  const dir = await Deno.makeTempDir({ prefix: "stage-installer-" });
  try {
    const out = join(dir, "install.sh");
    const env: Record<string, string> = { PATH: "/usr/bin:/bin", GITHUB_REF_NAME: opts.ref ?? tag };
    if (opts.source !== undefined) {
      env.STAGE_INSTALLER_SOURCE = join(dir, "source.sh");
      await Deno.writeTextFile(env.STAGE_INSTALLER_SOURCE, opts.source);
    }
    const r = await new Deno.Command("/bin/bash", {
      args: [SCRIPT, tag, out],
      clearEnv: true,
      env,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const text = await Deno.readTextFile(out).catch(() => null);
    const dec = new TextDecoder();
    return { code: r.code, out: dec.decode(r.stdout) + dec.decode(r.stderr), text };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const test = (name: string, fn: () => Promise<void>) => Deno.test({ name, ignore, fn });

test("the staged copy is install.sh with exactly the tag line changed", async () => {
  const r = await stage(TAG);
  assertEquals(r.code, 0, r.out);
  assertEquals(r.text, await staged(TAG));
  assertEquals(r.text!.split("\n").filter((l) => l === `RELEASE_TAG='${TAG}'`).length, 1);
});

test("a tag that is not this run's is refused", async () => {
  const r = await stage(TAG, { ref: "v0.0.1" });
  assertEquals(r.code, 1, r.out);
  assertStringIncludes(r.out, "is not the tag this run is for");
});

test("a tag deno.json does not declare is refused", async () => {
  const r = await stage("v0.0.1");
  assertEquals(r.code, 1, r.out);
  assertStringIncludes(r.out, `deno.json declares '${VERSION}'`);
});

for (const bad of ["9.4.0", "v9.4", "v9.4.0/x", "v9.4.0'", "latest"]) {
  test(`'${bad}' is not a release tag`, async () => {
    const r = await stage(bad);
    assertEquals(r.code, 1, r.out);
    assertStringIncludes(r.out, `'${bad}' is not a release tag`);
  });
}

test("a source without the placeholder once, or one that will not parse, is refused", async () => {
  const text = await Deno.readTextFile(INSTALL);
  for (const source of [text.replace(PLACEHOLDER, ""), `${text}\n${PLACEHOLDER}\n`]) {
    const r = await stage(TAG, { source });
    assertEquals(r.code, 1, r.out);
    assertStringIncludes(r.out, "holds the placeholder line");
  }
  const inline = await stage(TAG, { source: `${text}# not a line of its own: ${PLACEHOLDER}\n` });
  assertEquals(inline.code, 1, inline.out);
  assertStringIncludes(inline.out, "still carries the placeholder");
  const broken = await stage(TAG, { source: `${PLACEHOLDER}\nif then\n` });
  assertEquals(broken.code, 1, broken.out);
  assertStringIncludes(broken.out, "does not parse");
});
