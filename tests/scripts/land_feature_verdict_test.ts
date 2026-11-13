import { assertEquals, assertStringIncludes } from "@std/assert";
import { DELIMITER, join } from "@std/path";
import { git, hermetic, type Run, run, type Sandbox, sandbox } from "./git_sandbox.ts";
import { specnautOnPath } from "./specnaut_shim.ts";

/**
 * How land-feature.sh reads the verifier's answer, with a stub `specnaut` first on the PATH that
 * prints fixed lines and exits with a fixed code: each way the answer can fall short is exit 13
 * with nothing moved, and only a whole answer for this base lands.
 */

const DIGEST = `INSTRUCTIONS_DIGEST ${"0".repeat(64)}`;

async function featureBranch(): Promise<Sandbox> {
  const sb = await sandbox();
  await git(sb.work, "switch", "--quiet", "-c", "feature");
  await sb.commit("f", "x\n", "feat(7): a feature");
  return sb;
}

/** land-feature.sh with a `specnaut` that prints `lines` and exits `code`. */
async function landWith(sb: Sandbox, lines: string[], code = 0): Promise<Run> {
  const fake = join(sb.root, "fake");
  await Deno.mkdir(fake, { recursive: true });
  const printed = lines.map((l) => `'${l}'`).join(" ");
  const stub = `#!/usr/bin/env bash\nprintf '%s\\n' ${printed}\nexit ${code}\n`;
  await Deno.writeTextFile(join(fake, "specnaut"), stub);
  if (Deno.build.os !== "windows") await Deno.chmod(join(fake, "specnaut"), 0o755);
  const env = specnautOnPath(hermetic());
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH")!;
  return await run("bash", [".specnaut/scripts/bash/land-feature.sh"], sb.work, {
    [key]: `${fake}${DELIMITER}${env[key]}`,
  });
}

/** `lines` refused with 13, naming `why`, and nothing moved. */
async function refused(lines: string[], why: string, code = 0, base = "main") {
  const sb = await featureBranch();
  try {
    if (base !== "main") await baseNamed(sb, base);
    const before = await git(sb.remote, "rev-parse", base);
    const r = await landWith(sb, lines, code);
    assertEquals(r.code, 13, r.stderr);
    assertStringIncludes(r.stderr, why);
    assertEquals(await git(sb.work, "symbolic-ref", "--short", "HEAD"), "feature");
    assertEquals(await git(sb.remote, "rev-parse", base), before);
  } finally {
    await sb.cleanup();
  }
}

/** Makes `name` origin's default branch, at main's commit. */
async function baseNamed(sb: Sandbox, name: string) {
  await git(sb.work, "push", "--quiet", "origin", `main:refs/heads/${name}`);
  await git(sb.remote, "symbolic-ref", "HEAD", `refs/heads/${name}`);
  await git(sb.work, "remote", "set-head", "origin", name);
}

const TRUSTED = ["VERDICT instructions trusted", "VERDICT scripts trusted"];

Deno.test("a verdict measured from another base is no verdict: 13", async () => {
  await refused(["BASE_BRANCH develop", DIGEST, ...TRUSTED], "could not judge");
});

Deno.test("the base's name is matched as written, never as a pattern", async () => {
  await refused(["BASE_BRANCH relx1", DIGEST, ...TRUSTED], "could not judge", 0, "rel.1");
});
