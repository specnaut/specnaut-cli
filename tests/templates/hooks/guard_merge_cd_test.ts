import { assertEquals } from "@std/assert";
import { exists } from "@std/fs/exists";
import { bashPath, HARNESSES, makeRepo, pool, type Sandbox, sandbox } from "./hook_sandbox.ts";
import { bash, GATED, verdict } from "./guard_merge_fixture.ts";

/**
 * cli#710: in a workspace of several repositories, `cd apps/x && <landing>`
 * may land in apps/x, so apps/x's merge mode is read too. A cd can only
 * tighten the hold. The line is judged by the session's project AND every
 * directory its cds name, and it passes only if all of them read `auto`. A
 * target the guard cannot name for certain counts as `manual`: a non-literal
 * word (`$X`, `$(…)`, `~`), `cd -`, a bare `cd`, a missing directory, a
 * folder in no git repository, a repository that is not a Specnaut project.
 * The target's mode is read by the ROOT's reader (`merge-mode.sh --project`):
 * nothing that lives under a cd target ever runs.
 */

const WINDOWS = Deno.build.os === "windows";

/**
 * A root on `rootMode` holding apps/x (on `targetMode`), a plain repo, a plain
 * folder, an auto project the shell never names (`$X`), an auto project a
 * CDPATH lookup passes over (`x`) and, off Windows, `lnk` → elsewhere/inner,
 * where elsewhere is an auto project with its own apps/x folder.
 */
async function workspace(sb: Sandbox, rootMode: string, targetMode: string): Promise<string> {
  const root = await makeRepo(sb, { mode: rootMode, head: "feat" });
  await Deno.mkdir(`${root}/apps/nogit`, { recursive: true });
  await Deno.rename(await makeRepo(sb, { mode: targetMode, head: "feat" }), `${root}/apps/x`);
  await Deno.mkdir(`${root}/apps/x/docs`);
  const plain = await makeRepo(sb, { head: "feat" });
  await Deno.remove(`${plain}/.specnaut`, { recursive: true });
  await Deno.rename(plain, `${root}/apps/plain`);
  await Deno.rename(await makeRepo(sb, { mode: "auto", head: "feat" }), `${root}/$X`);
  await Deno.rename(await makeRepo(sb, { mode: "auto", head: "feat" }), `${root}/x`);
  if (!WINDOWS) {
    const elsewhere = await makeRepo(sb, { mode: "auto", head: "feat" });
    await Deno.mkdir(`${elsewhere}/inner`);
    await Deno.mkdir(`${elsewhere}/apps/x`, { recursive: true });
    await Deno.symlink(`${elsewhere}/inner`, `${root}/lnk`);
  }
  return root;
}

const PUSH = "git push origin main";

/** [root mode, target mode, command, gated?] — `@ROOT@` is the root's absolute path. */
type Form = readonly [root: string, target: string, command: string, gated: boolean];
const FORMS: ReadonlyArray<Form> = [
  // a target on manual holds the line, however the cd is spelled
  ["auto", "manual", `cd apps/x && ${PUSH}`, true],
  ["auto", "manual", `cd apps/x; ${PUSH}`, true],
  ["auto", "manual", `cd apps/x\n${PUSH}`, true],
  ["auto", "manual", `cd apps && cd x && ${PUSH}`, true],
  ["auto", "manual", `cd apps/x/docs && ${PUSH}`, true],
  ["auto", "manual", `cd 'apps/x' && ${PUSH}`, true],
  ["auto", "manual", `cd @ROOT@/apps/x && ${PUSH}`, true],
  ["auto", "manual", `pushd apps/x && ${PUSH}`, true],
  ["auto", "manual", "cd apps/x && bash .specnaut/scripts/bash/land-feature.sh feat", true],
  ["auto", "manual", `(cd apps/x) && ${PUSH}`, true],
  ["auto", "manual", `(cd apps/x && ${PUSH})`, true],
  ["auto", "manual", `env cd apps/x && ${PUSH}`, true],
  ["auto", "manual", `bash -c 'cd apps/x && ${PUSH}'`, true],
  ["auto", "manual", `CDPATH=apps; cd x && ${PUSH}`, true], // the shell goes to apps/x
  // ...and a target on auto never releases a root on manual (the security probe)
  ["manual", "auto", `cd apps/x && ${PUSH}`, true],
  ["manual", "auto", "cd apps/x && git -C .. push origin main", true],
  ["manual", "auto", "cd apps/x && git --git-dir=../../.git push origin main", true],
  ["manual", "auto", "cd apps/x && GIT_DIR=../../.git git push origin main", true],
  ["manual", "auto", "cd apps/x && gh pr merge 1 --squash", true],
  ["manual", "auto", "cd apps/x && git checkout main && git merge feat", true],
  ["manual", "auto", "cd apps/x && cd ../.. && git push origin main", true],
  ["manual", "auto", `cd @ROOT@/apps/x && git -C @ROOT@ push origin main`, true],
  ["manual", "auto", `builtin cd apps/x && ${PUSH}`, true],
  ["manual", "auto", `command cd apps/x && ${PUSH}`, true],
  ["manual", "auto", `\\cd apps/x && ${PUSH}`, true],
  ["manual", "auto", `cd -P apps/x && git merge main`, true],
  ["manual", "auto", `env -C apps/x ${PUSH}`, true],
  ["manual", "auto", `sudo -D apps/x ${PUSH}`, true],
  // every candidate on auto: nothing is held
  ["auto", "auto", `cd apps/x && ${PUSH}`, false],
  ["auto", "auto", `cd apps && cd x && ${PUSH}`, false],
  ["auto", "auto", `cd -P apps/x && ${PUSH}`, false],
  ["auto", "auto", `(cd apps/x && ${PUSH})`, false],
  ["auto", "auto", `true && cd apps/x && ${PUSH}`, false],
  ["auto", "auto", `cd apps/nogit && ${PUSH}`, false], // a folder of the root's own repository
  // a target that cannot be named for certain is manual
  ["auto", "auto", `cd apps/missing && ${PUSH}`, true],
  ["auto", "auto", `cd $X && ${PUSH}`, true],
  ["auto", "auto", `cd "$(echo apps/x)" && ${PUSH}`, true],
  ["auto", "auto", `cd ~ && ${PUSH}`, true],
  ["auto", "auto", `cd - && ${PUSH}`, true],
  ["auto", "auto", `cd && ${PUSH}`, true],
  ["auto", "auto", `cd apps/x x && ${PUSH}`, true],
  ["auto", "auto", `cd apps/x && popd && ${PUSH}`, true],
  ["auto", "auto", `popd apps/x; ${PUSH}`, true],
  ["auto", "auto", `pushd -n apps/x && ${PUSH}`, true],
  ["auto", "auto", `cd .. && ${PUSH}`, true], // the sandbox: no git repository
  ["auto", "auto", `cd apps/plain && ${PUSH}`, true], // a repository that is no Specnaut project
  // the path is carried as the shell carries it: logical, unless -P
  ...(WINDOWS ? [] : [
    ["auto", "manual", `cd lnk && cd ../apps/x && ${PUSH}`, true],
    ["auto", "manual", `cd -P lnk && cd ../apps/x && ${PUSH}`, false],
  ] as Form[]),
];

Deno.test("guard-merge: every cd target on the line is judged with the session's project", async () => {
  const sb = await sandbox();
  try {
    const roots: Record<string, string> = {};
    for (const key of new Set(FORMS.map(([r, t]) => `${r}:${t}`))) {
      const [r, t] = key.split(":");
      roots[key] = await workspace(sb, r, t);
    }
    const cases = HARNESSES.flatMap((harness) => FORMS.map((form) => [harness, ...form] as const));
    const got = await pool(cases, ([harness, r, t, command]) => {
      const root = roots[`${r}:${t}`];
      return bash(sb, harness, root, command.replaceAll("@ROOT@", bashPath(root)));
    });
    const wrong = cases.flatMap(([harness, r, t, command, gated], i) => {
      const want = gated ? GATED[harness] : "allow";
      const v = verdict(got[i]);
      return v === want ? [] : [
        `${harness} [root ${r}, apps/x ${t}] ${JSON.stringify(command)}: want ${want}, got ${v}`,
      ];
    });
    assertEquals(wrong, [], wrong.join("\n"));
  } finally {
    await sb.cleanup();
  }
});

Deno.test("guard-merge: nothing that lives under a cd target runs", async () => {
  // A cloned repository's own scripts are untrusted code: had the hook run
  // them, `cd <clone> && git pull` would execute the clone before any prompt.
  const sb = await sandbox();
  try {
    const root = await makeRepo(sb, { mode: "auto", head: "feat" });
    await Deno.mkdir(`${root}/apps`);
    await Deno.rename(await makeRepo(sb, { mode: "manual", head: "feat" }), `${root}/apps/x`);
    const marker = `${sb.dir}/ran`;
    for (const s of ["merge-mode.sh", "base-branch.sh", "merge-hold.sh"]) {
      await Deno.writeTextFile(
        `${root}/apps/x/.specnaut/scripts/bash/${s}`,
        `#!/usr/bin/env bash\necho ${s} >> '${bashPath(marker)}'\necho auto\n`,
      );
    }
    for (const harness of HARNESSES) {
      for (const command of ["cd apps/x && git pull", `cd apps/x && ${PUSH}`]) {
        const r = await bash(sb, harness, root, command);
        // Gated: the target's own workflow.yml says manual, read by the root's reader.
        assertEquals(verdict(r), GATED[harness], `${harness} ${command}: ${r.stderr}`);
      }
    }
    if (await exists(marker)) {
      throw new Error(`a target's script ran: ${await Deno.readTextFile(marker)}`);
    }
  } finally {
    await sb.cleanup();
  }
});
