import { assertEquals } from "@std/assert";
import { HARNESSES, makeRepo, pool, sandbox } from "./hook_sandbox.ts";
import { bash, GATED, verdict } from "./guard_merge_fixture.ts";

/**
 * Spec 042 — the scripts that land on the base branch (merge-commands.txt)
 * are gated under `merge: manual` however they are reached, and allowed under
 * `auto`. And the wrappers that run their argument (timeout, xargs, find
 * -exec, source, …) no longer hide a `git push` from the guard: before this,
 * `timeout 60 git push origin main` was allowed under manual.
 */

const SCRIPTS = ["land-feature.sh", "remove-spec.sh"];

/** Every way a listed script is reached; `S` stands for its name. */
const REACHED = [
  "S",
  ".specnaut/scripts/bash/S",
  "/opt/project/.specnaut/scripts/bash/S",
  "bash .specnaut/scripts/bash/S",
  "sh S",
  "sh -c '.specnaut/scripts/bash/S'",
  "env S",
  "timeout 600 bash .specnaut/scripts/bash/S",
  "cd sub && ./S",
  "source .specnaut/scripts/bash/S",
  ". .specnaut/scripts/bash/S",
  "git status && S",
];

/**
 * Spellings that run a listed script under another name: a case-folding
 * filesystem (APFS, NTFS) runs `Land-Feature.sh`, and the shell resolves a
 * variable, a glob or a brace after the hook has read the line. The controls
 * use the same characters where they do not name the command.
 */
const SPELLED: ReadonlyArray<[command: string, gated: boolean]> = [
  ["Land-Feature.sh", true],
  ["bash .specnaut/scripts/bash/REMOVE-SPEC.SH 007-x", true],
  ["land-*.sh", true],
  ["bash .specnaut/scripts/bash/land-feature.s?", true],
  ["./land-feature.[s]h", true],
  ["{land-feature,x}.sh", true],
  ["$S", true],
  ['"$S" 007-x', true],
  ["${S}", true],
  ["S=.specnaut/scripts/bash/land-feature.sh; bash $S", true],
  ["`echo land-feature.sh`", true],
  ["$(echo .specnaut/scripts/bash/land-feature.sh)", true],
  ['"$(echo land-feature.sh)" 007-x', true],
  ["${X:-.specnaut/scripts/bash/land-feature.sh}", true],
  ["${X:-land-feature.sh} 007-x", true],
  ["land-(feature).sh", true],
  // a substitution inside a word does not end the command around it
  ['git -C "$(git rev-parse --show-toplevel)" merge feature', true],
  ['git -c "user.name=$(whoami)" push origin main', true],
  ["git $(echo merge) feature", true],
  ['git commit -m "$(cat a) and $(cat b)"', false],
  ['echo "built $(git rev-parse --short HEAD) at $(date)"', false],
  ["echo `date` and `whoami`", false],
  // a process substitution runs a command too
  ["cat <(git push origin main)", true],
  ["tee >(git push origin main)", true],
  ["cat <(bash .specnaut/scripts/bash/land-feature.sh 007-x)", true],
  ["diff <(sort a) <(sort b)", false],
  ["f() { echo hi; }; f", false],
  ["ls *.sh", false],
  ["grep -l push .specnaut/scripts/bash/*.sh", false],
  ["cat .specnaut/scripts/bash/land-feature.sh", false],
  ["echo $HOME ${PWD} $(date)", false],
  ['"$HOME/bin/tool" --help', false],
  ["[ -f land-feature.sh ] && [[ -n $x ]]", false],
];

/** [command, gated under manual?] — a wrapper reads like the command it runs. */
const WRAPPED: ReadonlyArray<[command: string, gated: boolean]> = [
  ["timeout 60 git push origin main", true],
  ["timeout -s KILL -k 5 60 git push origin main", true],
  ["timeout --signal=KILL 1m git push origin main", true],
  ["gtimeout 60 git push origin main", true],
  ["xargs git push origin main", true],
  ["echo main | xargs -n 1 git push origin", true],
  ["find . -exec git push origin main \\;", true],
  ["find . -name x -execdir git push origin main +", true],
  ["find . -ok git push origin main ';' -print", true],
  ["caffeinate -i git push origin main", true],
  ["stdbuf -oL git push origin main", true],
  ["ionice -c 3 git push origin main", true],
  ["chrt -f 1 git push origin main", true],
  ["taskset -c 0 git push origin main", true],
  ["flock /tmp/lock git push origin main", true],
  ["source ./ship.sh && git push origin main", true],
  // controls: the same wrappers around a command that lands nothing
  ["timeout 60 git status", false],
  ["xargs -n 1 echo", false],
  ["find . -name '*.md' -exec grep -l push {} \\;", false],
  ["find . -name x -print", false],
  ["source ./env.sh", false],
  ["flock /tmp/lock git log -1", false],
  // an empty word as the command: nothing runs, and nothing crashes
  ['""', false],
  ['"" ; git push origin main', true],
];

Deno.test("guard-merge: a listed script is gated under manual however it is reached", async () => {
  const sb = await sandbox();
  try {
    const manual = await makeRepo(sb, { head: "feat" });
    const auto = await makeRepo(sb, { head: "feat", mode: "auto" });
    const commands = SCRIPTS.flatMap((s) => REACHED.map((form) => form.replaceAll("S", s)));
    const cases = HARNESSES.flatMap((h) =>
      commands.flatMap((c) => [[h, manual, c, true], [h, auto, c, false]] as const)
    );
    const got = await pool(cases, ([h, repo, command]) => bash(sb, h, repo, command));
    const wrong = cases.flatMap(([h, repo, command, gated], i) => {
      const want = gated ? GATED[h] : "allow";
      const v = verdict(got[i]);
      const mode = repo === manual ? "manual" : "auto";
      return v === want
        ? []
        : [`${h} [${mode}] ${JSON.stringify(command)}: want ${want}, got ${v}`];
    });
    assertEquals(wrong, [], wrong.join("\n"));
  } finally {
    await sb.cleanup();
  }
});

Deno.test("guard-merge: a wrapper does not hide the command it runs", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { head: "feat" });
    const cases = HARNESSES.flatMap((h) => WRAPPED.map((form) => [h, ...form] as const));
    const got = await pool(cases, ([h, command]) => bash(sb, h, repo, command));
    const wrong = cases.flatMap(([h, command, gated], i) => {
      const want = gated ? GATED[h] : "allow";
      const v = verdict(got[i]);
      return v === want ? [] : [`${h} ${JSON.stringify(command)}: want ${want}, got ${v}`];
    });
    assertEquals(wrong, [], wrong.join("\n"));
  } finally {
    await sb.cleanup();
  }
});

Deno.test("guard-merge: a listed script spelled in another case, a glob or a variable is still gated", async () => {
  const sb = await sandbox();
  try {
    const manual = await makeRepo(sb, { head: "feat" });
    const auto = await makeRepo(sb, { head: "feat", mode: "auto" });
    const cases = HARNESSES.flatMap((h) =>
      SPELLED.flatMap(([c, gated]) => [[h, manual, c, gated], [h, auto, c, false]] as const)
    );
    const got = await pool(cases, ([h, repo, command]) => bash(sb, h, repo, command));
    const wrong = cases.flatMap(([h, repo, command, gated], i) => {
      const want = gated ? GATED[h] : "allow";
      const v = verdict(got[i]);
      const mode = repo === manual ? "manual" : "auto";
      return v === want
        ? []
        : [`${h} [${mode}] ${JSON.stringify(command)}: want ${want}, got ${v}`];
    });
    assertEquals(wrong, [], wrong.join("\n"));
  } finally {
    await sb.cleanup();
  }
});
