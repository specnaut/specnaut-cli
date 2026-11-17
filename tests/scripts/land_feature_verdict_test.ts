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

/** Where the stub writes the arguments it was given, one per line. */
const argsOf = (sb: Sandbox) => join(sb.root, "args");

/** land-feature.sh, given `args`, with a `specnaut` that prints `lines` and exits `code`. */
async function landWith(sb: Sandbox, lines: string[], code = 0, args: string[] = []): Promise<Run> {
  const fake = join(sb.root, "fake");
  await Deno.mkdir(fake, { recursive: true });
  const printed = lines.map((l) => `'${l}'`).join(" ");
  const record = `printf '%s\\n' "$@" > '${argsOf(sb)}'`;
  const stub = `#!/usr/bin/env bash\n${record}\nprintf '%s\\n' ${printed}\nexit ${code}\n`;
  await Deno.writeTextFile(join(fake, "specnaut"), stub);
  if (Deno.build.os !== "windows") await Deno.chmod(join(fake, "specnaut"), 0o755);
  const env = specnautOnPath(hermetic());
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH")!;
  return await run("bash", [".specnaut/scripts/bash/land-feature.sh", ...args], sb.work, {
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

Deno.test("a verifier that could not run is 13, even printing a digest", async () => {
  await refused(["BASE_BRANCH main", DIGEST, ...TRUSTED], "could not judge", 3);
});

Deno.test("a verdict with no digest line is 13", async () => {
  await refused(["BASE_BRANCH main", ...TRUSTED], "could not judge");
});

Deno.test("a failure inside the verdict's reading is 12, named, never a raw exit", async () => {
  const sb = await featureBranch();
  try {
    const before = await git(sb.remote, "rev-parse", "main");
    // A names file `rm -f` cannot remove: a folder.
    const folder = join(sb.root, "names-folder");
    await Deno.mkdir(folder);
    const r = await landWith(sb, ["BASE_BRANCH main", `NAMES_FILE ${folder}`, DIGEST, ...TRUSTED]);
    assertEquals(r.code, 12, r.stderr);
    assertStringIncludes(r.stderr, "nothing was pushed");
    assertEquals(await git(sb.remote, "rev-parse", "main"), before);
  } finally {
    await sb.cleanup();
  }
});

const A = "a".repeat(64);
const B = "b".repeat(64);

/** The lines of a run that judged HEAD for main, with `extra` before the last one. */
const judged = (extra: string[], last = "VERDICT scripts untrusted") => [
  "BASE_BRANCH main",
  DIGEST,
  ...extra,
  last,
];

/** `lines` with exit `code`, given `args`: landed, and the stub given `flags` when named. */
async function landedWith(lines: string[], code: number, args: string[], flags?: string[]) {
  const sb = await featureBranch();
  try {
    const head = await git(sb.work, "rev-parse", "HEAD");
    const r = await landWith(sb, lines, code, args);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(await git(sb.remote, "rev-parse", "main"), head);
    if (flags === undefined) return;
    const seen = (await Deno.readTextFile(argsOf(sb))).trimEnd().split("\n");
    assertEquals(seen, ["verify-scripts", ...flags], args.join(" "));
  } finally {
    await sb.cleanup();
  }
}

/** `lines` with exit `code`, given `args`: 13 naming `why`, and nothing moved. */
async function refusedWith(lines: string[], code: number, args: string[], why = NOT_HELD) {
  const sb = await featureBranch();
  try {
    const before = await git(sb.remote, "rev-parse", "main");
    const r = await landWith(sb, lines, code, args);
    assertEquals(r.code, 13, r.stderr);
    assertStringIncludes(r.stderr, why);
    assertEquals(await git(sb.remote, "rev-parse", "main"), before);
  } finally {
    await sb.cleanup();
  }
}

const NOT_HELD = "neither trusted nor the digest passed";
const SCRIPTS_YES = `APPROVAL scripts holds ${A}`;

Deno.test("each digest held is passed on as its flag, and none when none is held", async () => {
  const lines = judged([TRUSTED[0], SCRIPTS_YES]);
  const trusted = judged([TRUSTED[0]], "VERDICT scripts trusted");
  await landedWith(trusted, 0, [], []);
  await landedWith(lines, 0, ["--scripts-digest", A], ["--approved-scripts", A]);
  await landedWith(trusted, 0, ["--instructions-digest", B], ["--approved-instructions", B]);
  await landedWith(lines, 0, ["--instructions-digest", B, "--scripts-digest", A], [
    "--approved-scripts",
    A,
    "--approved-instructions",
    B,
  ]);
});

Deno.test("without a scripts digest, a script or the lock the branch changed is 13", async () => {
  for (
    const reason of [
      "UNTRUSTED .specnaut/scripts/bash/x.sh differs from base",
      "UNTRUSTED .specnaut/installed.lock at base: no lock",
    ]
  ) await refusedWith(judged([TRUSTED[0], reason]), 1, []);
  await refusedWith(judged([TRUSTED[0]]), 1, []);
});

Deno.test("without a scripts digest, a local base ahead of origin is left to exit 6", async () => {
  await landedWith(
    judged([TRUSTED[0], "UNTRUSTED refs/heads/main local main ahead of origin"]),
    1,
    [],
  );
});

Deno.test("a scripts digest the binary says moved is 13; for the same digest, no yes covers it", async () => {
  const moved = (d: string) => judged([TRUSTED[0], `APPROVAL scripts moved ${d}`]);
  await refusedWith(moved(B), 1, ["--scripts-digest", A], "ask, then land again with it");
  await refusedWith(moved(A), 1, ["--scripts-digest", A], "a reason no yes can cover");
});

Deno.test("untrusted instructions land only on the binary's holds line for their digest", async () => {
  const untrusted = "VERDICT instructions untrusted AGENTS.md not on base";
  const scripts = "VERDICT scripts trusted";
  const args = ["--instructions-digest", A];
  await refusedWith(judged([untrusted]), 1, []);
  await refusedWith(judged([untrusted, `APPROVAL instructions moved ${B}`], scripts), 1, args);
  await landedWith(judged([untrusted, `APPROVAL instructions holds ${A}`], scripts), 0, args);
});
