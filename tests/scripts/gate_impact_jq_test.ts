// A jq that fails where its answer decides the run must widen, never narrow: an unread failure
// here reads as "nothing is affected". Each case runs under a `jq` that fails at one stage and
// behaves everywhere else, so the run reaches that stage. Bash only: the PowerShell twin has no jq.

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { FULL_MARKS } from "./gate_impact_case.ts";
import { impactRepo, labelled, type Repo } from "./gate_impact_fixture.ts";
import { spawn } from "./run_gate_fixture.ts";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";

/** A PATH whose `jq` exits 5 when its arguments hold `pattern`, and is the real one otherwise. */
async function stubbedPath(repo: Repo, pattern: string): Promise<string> {
  const real = (await spawn(["bash", "-c", "command -v jq"], repo.root)).stdout.trim();
  assert(real, "jq is not on PATH");
  const bin = join(repo.outside, "bin-stub");
  await Deno.mkdir(bin, { recursive: true });
  await Deno.writeTextFile(
    join(bin, "jq"),
    `#!/usr/bin/env bash\ncase "$*" in *${pattern}*) exit 5 ;; esac\nexec '${real}' "$@"\n`,
  );
  await Deno.chmod(join(bin, "jq"), 0o755);
  return `${bashPath(bin)}${Deno.build.os === "windows" ? ";" : ":"}${Deno.env.get("PATH")}`;
}

const STAGES: [string, string, string][] = [
  ["jq cannot do --rawfile", "--rawfile\\ gate_probe", "jq-unusable"],
  [
    "the adapter command cannot be read",
    "-r\\ .adapter.command",
    "declaration-unreadable: adapter.command",
  ],
  [
    "the adapter files cannot be read",
    ".adapter.files\\[\\]",
    "declaration-unreadable: adapter.files",
  ],
  ["the checks cannot be read", ".checks\\[\\]\\ \\|\\ \\[.gate", "declaration-unreadable: checks"],
  ["a change set cannot be paired with its snapshot", "--rawfile\\ paths", "graph-failed: pair"],
  ["the owners a check names cannot be read", "\\$known", "graph-failed: owners"],
  ["the affected set cannot be computed", "--slurpfile\\ cand", "graph-failed: closure"],
];

for (const [name, pattern, cause] of STAGES) {
  Deno.test(`gate impact (bash): when ${name}, the run widens and says so`, async () => {
    const repo = await impactRepo();
    await repo.commit({ "apps/web/a.ts": "changed\n" });
    const r = await repo.gate("bash", ["fast", "--base", repo.main], {
      env: { PATH: await stubbedPath(repo, pattern) },
    });
    assertEquals(r.code, 0, r.stdout + r.stderr);
    assertEquals(labelled(r, "scope"), ["full"], r.stdout);
    assertEquals(labelled(r, "fallback"), [cause], r.stdout);
    assertEquals(r.marks, FULL_MARKS);
  });
}
