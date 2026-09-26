// `.specnaut/feature.json` is committed on the feature branch — on purpose:
// `create-new-feature.sh` reads it from other branches with `git show` to reuse
// an epic's branch. So whatever `plan` writes into it is published with the
// project's history.
//
// The plan phase used to say "the resolved path, not the literal string". The
// resolved path is ABSOLUTE — `create-new-feature.sh` builds it on the repo
// root — so every project that ran `/specnaut plan` committed its author's home
// directory, username included. On a public repository that is a leak, and it
// also points every other checkout at a directory that exists on one machine.
//
// Both readers have always accepted a relative value and joined it onto the
// repo root. Only the instruction produced the absolute one, so the fix is the
// instruction — and the readers are pinned here so the fix cannot quietly break
// resolution on either side.

import { assert, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const PLAN = fromFileUrl(
  new URL("../../templates/core/skills/specnaut/phases/plan.md", import.meta.url),
);
const PS_COMMON = fromFileUrl(
  new URL("../../templates/core/specnaut/scripts/powershell/common.ps1", import.meta.url),
);

/** The paragraph that tells the agent what to write into feature.json. */
function persistInstruction(): string {
  const doc = Deno.readTextFileSync(PLAN);
  const start = doc.indexOf('`{ "feature_directory"');
  assert(start >= 0, "plan.md no longer carries the feature.json persist instruction");
  const end = doc.indexOf("\n\n", start);
  return doc.slice(start, end);
}

Deno.test("plan: feature_directory is persisted repo-relative, never as a resolved path", () => {
  const text = persistInstruction();
  assert(
    !/resolved (path|dir)/.test(text),
    `plan.md still asks for the resolved (absolute) path in a committed file:\n${text}`,
  );
  assertStringIncludes(text, ".specnaut/specs/");
  assertStringIncludes(text, "repo-relative");
});

async function hasPwsh(): Promise<boolean> {
  try {
    const { code } = await new Deno.Command("pwsh", {
      args: ["-NoProfile", "-Command", "exit 0"],
      stdout: "null",
      stderr: "null",
    }).output();
    return code === 0;
  } catch {
    return false;
  }
}

const PWSH_AVAILABLE = await hasPwsh();

Deno.test("plan: the PowerShell reader arm actually runs where it must", () => {
  if (Deno.env.get("CI") === "true") {
    assert(PWSH_AVAILABLE, "pwsh is absent on CI — the PowerShell reader was not exercised");
  } else if (!PWSH_AVAILABLE) {
    console.log("  note: pwsh not installed — PowerShell reader skipped locally");
  }
});

Deno.test({
  name: "plan: the PowerShell reader resolves a relative feature_directory under the repo root",
  ignore: !PWSH_AVAILABLE,
  fn: async () => {
    // The bash twin is pinned by feature_paths_absolute_test.ts ("a relative
    // path is still resolved under the repo root").
    const dir = await Deno.realPath(await Deno.makeTempDir({ prefix: "feature-dir-rel-" }));
    try {
      const git = async (...args: string[]) => {
        await new Deno.Command("git", { args, cwd: dir, stdout: "null", stderr: "null" })
          .output();
      };
      await git("init", "-q");
      await git("config", "user.email", "t@example.invalid");
      await git("config", "user.name", "t");
      await Deno.mkdir(join(dir, ".specnaut", "specs", "002-beta"), { recursive: true });
      await Deno.writeTextFile(join(dir, "README.md"), "x\n");
      await git("add", "-A");
      await git("commit", "-qm", "init");
      await git("checkout", "-qb", "002-beta");
      await Deno.writeTextFile(
        join(dir, ".specnaut", "feature.json"),
        JSON.stringify({ feature_directory: ".specnaut/specs/002-beta", linked_issue: null }),
      );

      const { code, stdout, stderr } = await new Deno.Command("pwsh", {
        args: [
          "-NoProfile",
          "-Command",
          `. '${PS_COMMON}'; (Get-FeaturePathsEnv).FEATURE_DIR`,
        ],
        cwd: dir,
        stdout: "piped",
        stderr: "piped",
      }).output();
      const out = new TextDecoder().decode(stdout).trim();
      assert(code === 0, `pwsh exited ${code}:\n${new TextDecoder().decode(stderr)}`);
      assert(
        out === join(dir, ".specnaut", "specs", "002-beta"),
        `a relative feature_directory did not land under the repo root: ${out}`,
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
