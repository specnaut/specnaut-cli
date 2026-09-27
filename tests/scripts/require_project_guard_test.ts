// The `require_project` guard on the github backlog backend (#569).
//
// The defect it exists for: `.specnaut/backlog-config.yml` carries two
// independent addressing keys — `repo:` and `project_number:` — and the read
// paths (`list.sh`, `view.sh`) use only the first. So a wrong project number
// leaves every visible command working while every project WRITE is dead, and
// the failure only surfaces as a resolution error deep inside a mutation.
//
// These tests run the scripts from the FLATTENED runtime destination
// (`.specnaut/scripts/backlog/`), not from the source tree: `_config.sh`
// resolves `ROOT` as three levels up from its own directory, which is the
// project root from that destination and nowhere else. Running them in place
// would exit 2 on a missing config and pass for the wrong reason.
//
// `gh` is stubbed rather than mocked at the shell level, because the guard's
// contract is about what it does with `gh`'s exit codes.

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { join } from "@std/path";

const SRC = fromFileUrl(
  new URL("../../templates/core/skills/board/scripts/github/", import.meta.url),
);

/** A `gh` that authenticates, refuses to resolve any project, and lists 1 and 7. */
const GH_NON_RESOLVING = `#!/usr/bin/env bash
case "$1 $2" in
  "auth status") exit 0 ;;
  "project view") exit 1 ;;
  "project list") echo '[{"number":1},{"number":7}]'; exit 0 ;;
esac
exit 0
`;

/** A `gh` that resolves the project fine — the positive control. */
const GH_RESOLVING = `#!/usr/bin/env bash
case "$1 $2" in
  "auth status") exit 0 ;;
  "project view") echo '{"id":"PVT_x"}'; exit 0 ;;
  "project list") echo '[{"number":1},{"number":7}]'; exit 0 ;;
esac
exit 0
`;

/**
 * A `gh` shaped like the reported rate-limit failure (#623): the view fails
 * with an error that names NOTHING about rate limits, and the listing fails
 * with GraphQL's own `RATE_LIMIT`. Neither call proves anything about the
 * project, so the guard must not claim it "does not resolve".
 */
const GH_RATE_LIMITED = `#!/usr/bin/env bash
case "$1 $2" in
  "auth status") exit 0 ;;
  "project view") echo 'unknown owner type' >&2; exit 1 ;;
  "project list")
    echo 'GraphQL: API rate limit already exceeded for user ID 1. (RATE_LIMIT)' >&2
    exit 1 ;;
esac
exit 0
`;

/**
 * A `gh` whose view fails but whose listing SUCCEEDS and names the configured
 * number: the project demonstrably exists, so the view failure is a fault to
 * retry, not a wrong number.
 */
const GH_VIEW_FAILS_BUT_LISTED = `#!/usr/bin/env bash
case "$1 $2" in
  "auth status") exit 0 ;;
  "project view") echo 'HTTP 502: Bad Gateway (view-side marker)' >&2; exit 1 ;;
  "project list") echo '{"projects":[{"number":7},{"number":42}],"totalCount":2}'; exit 0 ;;
esac
exit 0
`;

/** A `gh` whose listing succeeds and is EMPTY — zero projects, not a failure. */
const GH_ZERO_PROJECTS = `#!/usr/bin/env bash
case "$1 $2" in
  "auth status") exit 0 ;;
  "project view") exit 1 ;;
  "project list") echo '{"projects":[],"totalCount":0}'; exit 0 ;;
esac
exit 0
`;

/**
 * A `gh` that lists the configured project only when asked for closed projects
 * AND for more than the default page of 30. `gh project list` omits both by
 * default, so a listing without those flags is not the complete set — and an
 * incomplete listing is not proof that a number is absent.
 */
const GH_LISTED_ONLY_WHEN_COMPLETE = `#!/usr/bin/env bash
case "$1 $2" in
  "auth status") exit 0 ;;
  "project view") echo 'transient view failure (view-side marker)' >&2; exit 1 ;;
  "project list")
    closed=0; big=0; prev=""
    for a in "$@"; do
      [ "$a" = "--closed" ] && closed=1
      if [ "$prev" = "--limit" ] || [ "$prev" = "-L" ]; then [ "$a" -gt 30 ] && big=1; fi
      prev="$a"
    done
    if [ "$closed" = 1 ] && [ "$big" = 1 ]; then
      echo '{"projects":[{"number":1},{"number":42}],"totalCount":2}'
    else
      echo '{"projects":[{"number":1}],"totalCount":2}'
    fi
    exit 0 ;;
esac
exit 0
`;

const SEP = Deno.build.os === "windows" ? ";" : ":";

/**
 * A PATH that reaches the stubbed `gh` and the platform's own tools.
 *
 * Two earlier versions were wrong in opposite directions, and both were caught
 * by a runner rather than by a local run:
 *
 *   - `clearEnv` with a hard-coded `/usr/bin:/bin` broke windows-latest, where
 *     `bash` is Git Bash and those directories mean nothing.
 *   - Filtering out every directory that CONTAINS `gh` broke ubuntu, where
 *     `gh` lives in `/usr/bin` — so dropping that directory took `awk`, `sed`
 *     and `tr` with it. A blunt exclusion removes far more than it names.
 *
 * Prepending is enough for every case that WANTS a `gh`: the stub shadows any
 * real one. The absent-`gh` case is handled by `emptyBin()` below instead,
 * because PATH surgery cannot express "absent" without collateral damage.
 */
function pathWithStub(binDir: string): string {
  return `${binDir}${SEP}${Deno.env.get("PATH") ?? ""}`;
}

/** Absolute path of `name` on the inherited PATH, or null. */
function whichOnPath(name: string): string | null {
  for (const dir of (Deno.env.get("PATH") ?? "").split(SEP)) {
    if (dir.length === 0) continue;
    for (const candidate of [name, `${name}.exe`]) {
      try {
        if (Deno.statSync(join(dir, candidate)).isFile) return join(dir, candidate);
      } catch { /* not here */ }
    }
  }
  return null;
}

/**
 * The only tools `_config.sh` uses before `require_project` reaches its
 * `command -v gh` line. Copying exactly these into an otherwise empty
 * directory is what lets the absent-`gh` case be tested honestly: `gh` is
 * genuinely unreachable, and nothing else the script needs went missing with
 * it. If the config reader grows a new dependency this list must grow too —
 * the failure would be loud, naming the missing program.
 */
/**
 * `bash`'s absolute path, resolved once against the INHERITED PATH.
 *
 * `Deno.Command("bash", { env: { PATH } })` resolves the program name against
 * the CHILD's PATH, so the absent-`gh` case — which hands the child a directory
 * holding two programs — could not spawn a shell at all. Resolving here keeps
 * "what PATH the script sees" independent of "which shell runs it".
 */
function bashPath(): string {
  return whichOnPath("bash") ?? "bash";
}

/** Symlink where the platform allows it, copy where it does not. */
async function link(src: string, dest: string): Promise<void> {
  try {
    await Deno.symlink(src, dest);
  } catch {
    await Deno.copyFile(src, dest);
    await Deno.chmod(dest, 0o755);
  }
}

/** Run an arbitrary script with an explicit PATH, returning both streams. */
async function runScript(
  script: string,
  args: string[],
  path: string,
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await new Deno.Command(bashPath(), {
    args: [script, ...args],
    cwd,
    env: { PATH: path },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const d = new TextDecoder();
  return { stdout: d.decode(stdout), stderr: d.decode(stderr) };
}

const TOOLS_BEFORE_THE_GUARD = ["awk", "dirname"];

interface Box {
  dir: string;
  binDir: string;
  script: (name: string) => string;
}

async function box(ghStub: string | null): Promise<Box> {
  const dir = await Deno.makeTempDir({ prefix: "require-project-" });
  const backlog = join(dir, ".specnaut/scripts/backlog");
  await Deno.mkdir(backlog, { recursive: true });
  for await (const entry of Deno.readDir(SRC)) {
    if (!entry.isFile) continue;
    await Deno.copyFile(join(SRC, entry.name), join(backlog, entry.name));
    await Deno.chmod(join(backlog, entry.name), 0o755);
  }
  await Deno.writeTextFile(
    join(dir, ".specnaut/backlog-config.yml"),
    'repo: "myorg/myproject"\nproject_number: "42"\n',
  );
  const binDir = join(dir, "bin");
  await Deno.mkdir(binDir);
  if (ghStub !== null) {
    await Deno.writeTextFile(join(binDir, "gh"), ghStub);
    await Deno.chmod(join(binDir, "gh"), 0o755);
  }
  return { dir, binDir, script: (n) => join(backlog, n) };
}

async function run(
  b: Box,
  script: string,
  args: string[],
  pathOverride?: string,
): Promise<{ code: number; stderr: string }> {
  // The stub directory is PREPENDED to the inherited PATH rather than
  // replacing it. An earlier version cleared the environment and hard-coded
  // `/usr/bin:/bin`, which is meaningless on windows-latest: `bash` is Git
  // Bash there, and stripping its PATH left the scripts unable to find `sed`,
  // `tr` or `gh` — so all seven cases failed for a reason that had nothing to
  // do with the guard. Prepending keeps the stub authoritative for `gh` while
  // the platform's own tools stay reachable.
  const { code, stderr } = await new Deno.Command(bashPath(), {
    args: [b.script(script), ...args],
    cwd: b.dir,
    env: { PATH: pathOverride ?? pathWithStub(b.binDir) },
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { code, stderr: new TextDecoder().decode(stderr) };
}

const GUARDED = ["move.sh", "add.sh", "set-field.sh", "detect-fields.sh"];

for (const script of GUARDED) {
  Deno.test(`require_project: ${script} exits 2 when the project does not resolve`, async () => {
    const b = await box(GH_NON_RESOLVING);
    try {
      const { code, stderr } = await run(b, script, ["1", "Done"]);
      assertEquals(
        code,
        2,
        `${script} must exit 2 on a non-resolving project, got ${code}. stderr: ${stderr}`,
      );
      assert(
        stderr.includes("project #42 does not resolve"),
        `${script} must name the configured number, got: ${JSON.stringify(stderr)}`,
      );
      assert(
        stderr.includes("myorg"),
        `${script} must name the owner it failed for, got: ${JSON.stringify(stderr)}`,
      );
      // The whole reason the guard prints anything: the message has to be
      // actionable without a second command.
      assert(
        stderr.includes("projects that exist for") && /\b1\b/.test(stderr) &&
          /\b7\b/.test(stderr),
        `${script} must list the project numbers that DO exist, got: ${JSON.stringify(stderr)}`,
      );
      assert(
        stderr.includes("backlog-config.yml"),
        `${script} must name the file to edit, got: ${JSON.stringify(stderr)}`,
      );
    } finally {
      await Deno.remove(b.dir, { recursive: true });
    }
  });
}

Deno.test("require_project: a resolving project is not the guard's business", async () => {
  // The positive control. Without it, a guard that exited 2 unconditionally
  // would satisfy every assertion above.
  const b = await box(GH_RESOLVING);
  try {
    const { stderr } = await run(b, "move.sh", ["1", "Done"]);
    assert(
      !stderr.includes("does not resolve"),
      `the guard must stay quiet on a resolving project, got: ${JSON.stringify(stderr)}`,
    );
  } finally {
    await Deno.remove(b.dir, { recursive: true });
  }
});

Deno.test("require_project: a missing gh is not a config error", async () => {
  // Skipping when the tool is absent is the guard's stated contract: the
  // callers report a missing `gh` themselves, and turning that into "your
  // project number is wrong" would send the user to fix the wrong file.
  //
  // Proved POSITIVELY, with a marker the guard has to return in order to
  // reach. The first version of this test asserted only that the guard's
  // message was ABSENT, and it stayed green with BOTH skip lines deleted from
  // `_config.sh` — because the script was dying at its `. _config.sh` line
  // and never reaching the guard at all. An absence proves nothing about a
  // path that was never taken.
  //
  // "Absent" is built rather than filtered: the child gets a PATH holding
  // nothing but SYMLINKS to the two programs the config reader needs before
  // `command -v gh`. Symlinks, not copies — a copied system binary on macOS
  // loses its signature and fails to execute, which is precisely how the
  // earlier version died silently inside a command substitution.
  const b = await box(null);
  try {
    const onlyBin = join(b.dir, "onlybin");
    await Deno.mkdir(onlyBin);
    for (const tool of TOOLS_BEFORE_THE_GUARD) {
      const src = whichOnPath(tool);
      assert(src !== null, `${tool} is not on PATH — this harness cannot run here`);
      await link(src, join(onlyBin, tool));
    }

    const driver = join(b.dir, ".specnaut/scripts/backlog/_probe.sh");
    await Deno.writeTextFile(
      driver,
      '. "$(dirname "$0")/_config.sh"\nrequire_project\necho GUARD_RETURNED\n',
    );

    const { stdout, stderr } = await runScript(driver, [], onlyBin, b.dir);
    assert(
      stdout.includes("GUARD_RETURNED"),
      `the guard did not return — with no gh on PATH it must skip, not exit. ` +
        `stdout: ${JSON.stringify(stdout)} stderr: ${JSON.stringify(stderr)}`,
    );
    assert(
      !stderr.includes("does not resolve"),
      `a missing gh must not become a config error, got: ${JSON.stringify(stderr)}`,
    );
  } finally {
    await Deno.remove(b.dir, { recursive: true });
  }
});

Deno.test("require_project: an unauthenticated gh is not a config error", async () => {
  const b = await box(`#!/usr/bin/env bash\n[ "$1 $2" = "auth status" ] && exit 1\nexit 1\n`);
  try {
    const { stderr } = await run(b, "move.sh", ["1", "Done"]);
    assert(
      !stderr.includes("does not resolve"),
      `an unauthenticated gh must not become a config error, got: ${JSON.stringify(stderr)}`,
    );
  } finally {
    await Deno.remove(b.dir, { recursive: true });
  }
});

for (const script of GUARDED) {
  Deno.test(`require_project: ${script} exits 13, not 2, when gh fails and proves nothing`, async () => {
    const b = await box(GH_RATE_LIMITED);
    try {
      const { code, stderr } = await run(b, script, ["1", "Done"]);
      assertEquals(
        code,
        13,
        `${script} must exit 13 when the project cannot be verified, got ${code}. stderr: ${stderr}`,
      );
      // Markers only the new branch can emit: `gh`'s own words, passed
      // through verbatim. The old guard discarded both streams.
      assert(
        stderr.includes("unknown owner type"),
        `${script} must quote the view's gh error, got: ${JSON.stringify(stderr)}`,
      );
      assert(
        stderr.includes("RATE_LIMIT"),
        `${script} must quote the listing's gh error, got: ${JSON.stringify(stderr)}`,
      );
      assert(
        stderr.includes("could not verify project #42"),
        `${script} must say the project could not be verified, got: ${JSON.stringify(stderr)}`,
      );
      assert(
        !stderr.includes("does not resolve"),
        `${script} must not claim the project does not resolve, got: ${JSON.stringify(stderr)}`,
      );
      assert(
        !stderr.includes("backlog-config.yml"),
        `${script} must not send the user to edit the config, got: ${JSON.stringify(stderr)}`,
      );
      assert(
        stderr.includes("could not list"),
        `${script} must say the listing failed, got: ${JSON.stringify(stderr)}`,
      );
    } finally {
      await Deno.remove(b.dir, { recursive: true });
    }
  });

  Deno.test(`require_project: ${script} exits 13 when the view fails but the listing names the project`, async () => {
    const b = await box(GH_VIEW_FAILS_BUT_LISTED);
    try {
      const { code, stderr } = await run(b, script, ["1", "Done"]);
      assertEquals(
        code,
        13,
        `${script} must exit 13 when the project is listed but cannot be viewed, got ${code}. ` +
          `stderr: ${stderr}`,
      );
      assert(
        stderr.includes("view-side marker"),
        `${script} must quote the view's gh error, got: ${JSON.stringify(stderr)}`,
      );
      assert(
        !stderr.includes("does not resolve"),
        `${script} must not claim a listed project does not resolve, got: ${
          JSON.stringify(stderr)
        }`,
      );
    } finally {
      await Deno.remove(b.dir, { recursive: true });
    }
  });
}

Deno.test("require_project: a successful empty listing says zero projects, not 'could not list'", async () => {
  const b = await box(GH_ZERO_PROJECTS);
  try {
    const { code, stderr } = await run(b, "move.sh", ["1", "Done"]);
    assertEquals(code, 2, `an empty successful listing is proof, got ${code}. stderr: ${stderr}`);
    assert(
      stderr.includes("no projects are visible to this token"),
      `an empty listing must be reported as zero projects, got: ${JSON.stringify(stderr)}`,
    );
    assert(
      !stderr.includes("could not list"),
      `"could not list" is reserved for a listing that FAILED, got: ${JSON.stringify(stderr)}`,
    );
  } finally {
    await Deno.remove(b.dir, { recursive: true });
  }
});

Deno.test("require_project: only a complete listing (closed + past the first page) is proof", async () => {
  // `gh project list` defaults to open projects and a limit of 30. A number
  // absent from that is absent from a SAMPLE — a closed project, or the
  // thirty-first, would be reported as "does not resolve" with exit 2.
  const b = await box(GH_LISTED_ONLY_WHEN_COMPLETE);
  try {
    const { code, stderr } = await run(b, "move.sh", ["1", "Done"]);
    assertEquals(
      code,
      13,
      `a project present in the complete listing must not exit 2, got ${code}. stderr: ${stderr}`,
    );
    assert(
      !stderr.includes("does not resolve"),
      `a listed project must not be reported as unresolved, got: ${JSON.stringify(stderr)}`,
    );
  } finally {
    await Deno.remove(b.dir, { recursive: true });
  }
});
