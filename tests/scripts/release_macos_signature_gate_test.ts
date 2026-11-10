import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse } from "@std/yaml";

/**
 * `build`'s refusal of an unsigned macOS binary (cli#428), run against REAL
 * `rcodesign print-signature-info` output.
 *
 * `build` runs on Linux, so it reads the signature as text: the embedded leaf
 * certificate must be a Developer ID Application of the team, and the
 * designated requirement must name the identifier and the team, never a cdhash.
 * It does not verify the chain — macos-smoke does, with Apple's `codesign` —
 * and its message says "signed", nothing stronger.
 *
 * The fixture is the rehearsal binary's real output (its header says how it was
 * made). Its identity is a throwaway "Apple Development" certificate, so the
 * Developer ID cases are derived from it by replacing exactly the subject or
 * the requirement line: each case isolates one clause and asserts the line
 * that names it, not only an exit code.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SCRIPT = "scripts/release/require-macos-signed.sh";
const ignore = Deno.build.os === "windows"; // bash stubs, as in postflight_catalog_test.ts
const TEAM = "H87Y8Z6YPS";
const REAL = await Deno.readTextFile(`${ROOT}tests/fixtures/rcodesign/rehearsal-signed-arm64.yml`);
const REHEARSAL_SUBJECT =
  "CN=Apple Development: Rehearsal (ABCDE12345), OU=ABCDE12345, O=Rehearsal, C=XX";
const REHEARSAL_DR =
  `(identifier "com.specnaut.cli") and (certificate root = H"a043b5448edc9889b24cc78bb6336ce66943f7d4")`;
const DEVID_SUBJECT =
  `CN=Developer ID Application: Example Maintainer (${TEAM}), OU=${TEAM}, O=Example, C=US`;
const devidDr = (id: string, team: string) =>
  `(identifier "${id}") and ((anchor apple generic) and ((certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */) and ((certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */) and (certificate leaf[subject.OU] = "${team}"))))`;

function variant(subject: string, dr: string): string {
  assert(REAL.includes(REHEARSAL_SUBJECT) && REAL.includes(REHEARSAL_DR), "the fixture changed");
  return REAL.replaceAll(REHEARSAL_SUBJECT, subject).replace(REHEARSAL_DR, dr);
}
const SIGNED = variant(DEVID_SUBJECT, devidDr("com.specnaut.cli", TEAM));

/** The host's own copy of a tool, linked into the stub dir so PATH holds nothing else. */
async function hostTool(name: string): Promise<string> {
  const out = await new Deno.Command("bash", { args: ["-c", `command -v ${name}`] }).output();
  const path = new TextDecoder().decode(out.stdout).trim();
  assert(out.success && path, `${name} is not installed on this host`);
  return path;
}

async function stubDir(dir: string, info: string): Promise<string> {
  const bin = join(dir, "bin");
  await Deno.mkdir(bin);
  for (const tool of ["jq", "grep", "cat"]) {
    await Deno.symlink(await hostTool(tool), join(bin, tool));
  }
  await Deno.writeTextFile(join(dir, "info.yml"), info);
  await Deno.writeTextFile(join(bin, "rcodesign"), `#!/bin/bash\ncat ${join(dir, "info.yml")}\n`);
  await Deno.chmod(join(bin, "rcodesign"), 0o755);
  return bin;
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

async function gate(info: string, canonical: boolean, names = ["x64", "arm64"]) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-428-gate-" });
  try {
    const env = {
      PATH: await stubDir(dir, info),
      MACOS_JSON: JSON.stringify(names.map((a) => ({ outName: `specnaut-macos-${a}` }))),
      CANONICAL: String(canonical),
      MACOS_TEAM_ID: TEAM,
      MACOS_IDENTIFIER: "com.specnaut.cli",
    };
    return await bashIn([`${ROOT}${SCRIPT}`], dir, env);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("build runs the gate before attest, with the workflow's identity", async () => {
  const wf = parse(await Deno.readTextFile(`${ROOT}.github/workflows/release.yml`)) as {
    env: Record<string, string>;
    jobs: Record<string, { steps?: { name?: string; run?: string }[] }>;
  };
  const steps = wf.jobs.build.steps ?? [];
  const at = steps.findIndex((s) => s.run?.trim() === `bash ${SCRIPT}`);
  assert(at >= 0, `build does not run ${SCRIPT}`);
  assert(at < steps.findIndex((s) => s.name === "Attest build provenance"), "checked after attest");
  assertEquals([wf.env.MACOS_TEAM_ID, wf.env.MACOS_IDENTIFIER], [TEAM, "com.specnaut.cli"]);
});

Deno.test({
  name: "gate: a Developer ID subject and the team's requirement pass, as 'signed'",
  ignore,
}, async () => {
  const r = await gate(SIGNED, true);
  assertEquals(r.code, 0, r.out);
  assertStringIncludes(
    r.out,
    `specnaut-macos-arm64: signed by a Developer ID Application certificate of ${TEAM}`,
  );
  assertStringIncludes(r.out, "the chain is verified by macos-smoke, not here");
});

Deno.test(
  { name: "gate: the real rehearsal output (Apple Development) is refused", ignore },
  async () => {
    const r = await gate(REAL, true);
    assertEquals(r.code, 1, r.out);
    assertStringIncludes(
      r.out,
      `::error::specnaut-macos-x64: no Developer ID Application certificate of ${TEAM}`,
    );
  },
);

Deno.test(
  { name: "gate: the right requirement under the wrong subject is refused", ignore },
  async () => {
    const r = await gate(variant(REHEARSAL_SUBJECT, devidDr("com.specnaut.cli", TEAM)), true);
    assertEquals(r.code, 1, r.out);
    assertStringIncludes(r.out, `no Developer ID Application certificate of ${TEAM}`);
  },
);

Deno.test({ name: "gate: a cdhash requirement is refused", ignore }, async () => {
  const r = await gate(
    variant(DEVID_SUBJECT, `cdhash H"25140fb76f3194dd11ef0d6ee096ee6260dbe463"`),
    true,
  );
  assertEquals(r.code, 1, r.out);
  assertStringIncludes(r.out, "the designated requirement pins a cdhash");
});

Deno.test(
  { name: "gate: a requirement naming another identifier is refused", ignore },
  async () => {
    const r = await gate(variant(DEVID_SUBJECT, devidDr("com.example.other", TEAM)), true);
    assertEquals(r.code, 1, r.out);
    assertStringIncludes(r.out, "the designated requirement does not name com.specnaut.cli");
  },
);

Deno.test({ name: "gate: a requirement naming another team is refused", ignore }, async () => {
  const r = await gate(variant(DEVID_SUBJECT, devidDr("com.specnaut.cli", "ZZZZZZZZZZ")), true);
  assertEquals(r.code, 1, r.out);
  assertStringIncludes(r.out, `the designated requirement does not name team ${TEAM}`);
});

Deno.test(
  { name: "gate: a fork passes unsigned binaries through, with a warning", ignore },
  async () => {
    const r = await gate(REAL, false);
    assertEquals(r.code, 0, r.out);
    assertStringIncludes(r.out, "::warning::specnaut-macos-x64 is NOT signed");
  },
);

Deno.test(
  { name: "gate: an empty macOS target list is a failure, not a pass", ignore },
  async () => {
    const r = await gate(SIGNED, true, []);
    assertEquals(r.code, 1, r.out);
    assertStringIncludes(r.out, "::error::the target table lists no macOS binary");
  },
);
