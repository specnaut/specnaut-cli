import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ignore, inSandbox, install, staged, stubLog } from "./install_sh_sandbox.ts";

/**
 * cli#817 — which version `install.sh` installs, and whether it may install it on a checksum alone.
 * The user's pin (SPECNAUT_VERSION, then VERSION) wins over the tag a release staged into its copy,
 * which wins over the latest lookup. Releases before 4.3.0 carry no attestation: only an explicit
 * SPECNAUT_VERSION reaches that checksum-only branch, never an ambient VERSION, and anything that
 * is not a version reaches no branch.
 */

const test = (name: string, fn: () => Promise<void>) => Deno.test({ name, ignore, fn });
const latest = (tag: string) => `{"url": "x", "tag_name": "${tag}", "name": "x"}\n`;
const UNSIGNED = "v4.2.9 predates signed releases: checked against its checksum only";

for (const v of ["v10.0.0", "v4.10.0", "v4.3.0", "4.4.0", "v08.0.0"]) {
  test(`a pin of ${v} is checked against its attestation`, () =>
    inSandbox({}, async (s) => {
      const r = await install(s, { SPECNAUT_VERSION: v, DRY_RUN: "1" });
      assertEquals(r.code, 0, r.out);
      assertStringIncludes(r.out, `verify the attestation for `);
      assertStringIncludes(r.out, `/releases/download/v${v.replace(/^v/, "")}/`);
    }));
}

for (const v of ["v4.2.9", "v4.3.0-rc.1"]) {
  test(`a pin of ${v} predates signing, and is checked on its checksum only`, () =>
    inSandbox({}, async (s) => {
      const r = await install(s, { SPECNAUT_VERSION: v, DRY_RUN: "1" });
      assertEquals(r.code, 0, r.out);
      assertStringIncludes(r.out, `check the checksum only: ${v} predates signed releases`);
    }));
}

for (const v of ["latest", "v4.3", "v4.3.0.1", "v4.3.0;rm", " v4.3.0"]) {
  test(`a pin of '${v}' is not a version, and installs nothing`, () =>
    inSandbox({}, async (s) => {
      const r = await install(s, { SPECNAUT_VERSION: v });
      assertEquals(r.code, 1, r.out);
      assertStringIncludes(r.out, `not a release version: '${v}'`);
      assertEquals(await stubLog(s, "curl"), "", "an unparsed version reached a URL");
    }));
}

test("an explicit pre-4.3.0 pin installs on its checksum, and never asks gh", () =>
  inSandbox({}, async (s) => {
    const r = await install(s, { SPECNAUT_VERSION: "v4.2.9" });
    assertEquals(r.code, 0, r.out);
    assertStringIncludes(r.out, UNSIGNED);
    assertStringIncludes(r.out, "specnaut 9.9.9");
    assertEquals(await stubLog(s, "gh"), "");
    assert(!(await stubLog(s, "curl")).includes(".sigstore.json"), "the bundle was fetched");
  }));

test("an ambient VERSION below 4.3.0 is refused, never installed on a checksum", () =>
  inSandbox({}, async (s) => {
    const r = await install(s, { SPECNAUT_VERSION: "", VERSION: "v4.2.9" });
    assertEquals(r.code, 1, r.out);
    assertStringIncludes(r.out, "v4.2.9 predates signed releases (4.3.0) and SPECNAUT_VERSION");
    assertEquals(await stubLog(s, "curl"), "");
  }));

test("VERSION still pins a signed release", () =>
  inSandbox({}, async (s) => {
    const r = await install(s, { SPECNAUT_VERSION: "", VERSION: "v9.9.9" });
    assertEquals(r.code, 0, r.out);
    assertStringIncludes(r.out, "attestation verified for");
  }));

test("REQUIRE_ATTESTATION=1 refuses a pre-4.3.0 pin", () =>
  inSandbox({}, async (s) => {
    const r = await install(s, { SPECNAUT_VERSION: "v4.2.9", REQUIRE_ATTESTATION: "1" });
    assertEquals(r.code, 1, r.out);
    assertStringIncludes(r.out, "it has no attestation, and REQUIRE_ATTESTATION is set");
    assertEquals(await stubLog(s, "curl"), "");
  }));

test("SPECNAUT_VERSION wins over VERSION", () =>
  inSandbox({}, async (s) => {
    const r = await install(s, { SPECNAUT_VERSION: "v9.9.9", VERSION: "v4.2.9", DRY_RUN: "1" });
    assertStringIncludes(r.out, "/releases/download/v9.9.9/");
  }));

test("a staged copy installs its own release, with no lookup, and a pin still wins", async () =>
  inSandbox({ script: await staged("v9.9.9") }, async (s) => {
    const r = await install(s, { SPECNAUT_VERSION: "" });
    assertEquals(r.code, 0, r.out);
    assertStringIncludes(r.out, "attestation verified for");
    assert(!(await stubLog(s, "curl")).includes("api.github.com"), "the latest was looked up");
    const pinned = await install(s, { SPECNAUT_VERSION: "v4.2.9", PREFIX: join(s.home, "b") });
    assertEquals(pinned.code, 0, pinned.out);
    assertStringIncludes(pinned.out, UNSIGNED);
  }));

test("a pre-4.3.0 version nobody pinned is refused, staged or looked up", async () => {
  await inSandbox({ script: await staged("v4.2.9") }, async (s) => {
    const r = await install(s, { SPECNAUT_VERSION: "" });
    assertEquals(r.code, 1, r.out);
    assertStringIncludes(r.out, "v4.2.9 predates signed releases (4.3.0) and SPECNAUT_VERSION");
  });
  await inSandbox({ latest: latest("v4.2.9") }, async (s) => {
    const r = await install(s, { SPECNAUT_VERSION: "" });
    assertEquals(r.code, 1, r.out);
    assertStringIncludes(r.out, "and SPECNAUT_VERSION does not pin it");
    assertEquals((await stubLog(s, "curl")).trim().split("\n").length, 1, "only the lookup");
  });
});

test("the latest lookup's answer is checked before it reaches a URL", () =>
  inSandbox({ latest: latest("v9.9.9/../../evil") }, async (s) => {
    const r = await install(s, { SPECNAUT_VERSION: "" });
    assertEquals(r.code, 1, r.out);
    assertStringIncludes(r.out, "not a release version: 'v9.9.9/../../evil'");
    assertEquals((await stubLog(s, "curl")).trim().split("\n").length, 1, "only the lookup");
  }));

test("the latest release is installed when nothing pins one", () =>
  inSandbox({ latest: latest("v9.9.9") }, async (s) => {
    const r = await install(s, { SPECNAUT_VERSION: "" });
    assertEquals(r.code, 0, r.out);
    assertStringIncludes(r.out, "attestation verified for");
    assertStringIncludes(await stubLog(s, "curl"), "/releases/download/v9.9.9/");
  }));
