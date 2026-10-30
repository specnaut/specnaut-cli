import { assertEquals } from "@std/assert";
import { bashPath, HARNESSES, makeRepo, pool, type Sandbox, sandbox } from "./hook_sandbox.ts";
import { bash, GATED, verdict } from "./guard_merge_fixture.ts";

/**
 * cli#710 — in a workspace of several repositories, `cd apps/x && <landing>`
 * lands in apps/x, so it is judged by apps/x's merge mode, not the session
 * root's. A target the guard cannot name for certain counts as `manual`: a
 * non-literal word (`$X`, `$(…)`, `~`), `cd -`, a bare `cd`, a directory that
 * does not exist, one in no git repository, one in a repository that is no
 * Specnaut project. And the target replaces the root only when the `cd` runs,
 * in this shell, before everything else on the line: a `cd` in a subshell,
 * a pipeline, the background, behind a wrapper or after another command may
 * not have moved what lands — so the root is judged too.
 */

/** A root on `rootMode` holding apps/x (on `targetMode`), a plain repo and a plain dir. */
async function workspace(sb: Sandbox, rootMode: string, targetMode: string): Promise<string> {
  const root = await makeRepo(sb, { mode: rootMode, head: "feat" });
  await Deno.mkdir(`${root}/apps/nogit`, { recursive: true });
  await Deno.rename(await makeRepo(sb, { mode: targetMode, head: "feat" }), `${root}/apps/x`);
  await Deno.mkdir(`${root}/apps/x/docs`);
  const plain = await makeRepo(sb, { head: "feat" });
  await Deno.remove(`${plain}/.specnaut`, { recursive: true });
  await Deno.rename(plain, `${root}/apps/plain`);
  // an auto project named as the shell never reads the word: `cd $X` is not it
  await Deno.rename(await makeRepo(sb, { mode: "auto", head: "feat" }), `${root}/$X`);
  // an auto project a CDPATH lookup passes over for apps/x
  await Deno.rename(await makeRepo(sb, { mode: "auto", head: "feat" }), `${root}/x`);
  return root;
}

const PUSH = "git push origin main";

/** [root mode, target mode, command, gated?] */
const FORMS: ReadonlyArray<[root: string, target: string, command: string, gated: boolean]> = [
  // the target's mode decides, both ways
  ["auto", "manual", `cd apps/x && ${PUSH}`, true],
  ["auto", "manual", `cd apps/x; ${PUSH}`, true],
  ["auto", "manual", `cd apps/x\n${PUSH}`, true],
  ["auto", "manual", `cd apps && cd x && ${PUSH}`, true],
  ["auto", "manual", `cd apps/x/docs && ${PUSH}`, true],
  ["auto", "manual", `cd 'apps/x' && ${PUSH}`, true],
  ["auto", "manual", "cd apps/x && bash .specnaut/scripts/bash/land-feature.sh feat", true],
  ["manual", "auto", `cd apps/x && ${PUSH}`, false],
  ["manual", "auto", `cd apps && cd x && ${PUSH}`, false],
  ["manual", "auto", `cd -P apps/x && git merge main`, false],
  ["manual", "auto", `cd apps/x/docs && ${PUSH}`, false],
  ["auto", "auto", `cd apps/x && ${PUSH}`, false],
  ["manual", "auto", `cd $X && cd @ROOT@/apps/x && ${PUSH}`, false], // absolute: lands there whatever came before
  ["auto", "manual", `cd $X && cd @ROOT@/apps/x && ${PUSH}`, true],
  // a folder of the root's own repository is the root's project
  ["manual", "auto", `cd apps/nogit && ${PUSH}`, true],
  ["auto", "manual", `cd apps/nogit && ${PUSH}`, false],
  // a target that cannot be named for certain is manual
  ["auto", "auto", `cd apps/missing && ${PUSH}`, true],
  ["auto", "auto", `cd $X && ${PUSH}`, true],
  ["auto", "auto", `cd "$(echo apps/x)" && ${PUSH}`, true],
  ["auto", "auto", `cd ~ && ${PUSH}`, true],
  ["auto", "auto", `cd - && ${PUSH}`, true],
  ["auto", "auto", `cd && ${PUSH}`, true],
  ["auto", "auto", `cd apps/x x && ${PUSH}`, true],
  ["auto", "auto", `cd apps/x && popd && ${PUSH}`, true],
  ["auto", "auto", `cd .. && ${PUSH}`, true], // the sandbox: no git repository
  ["auto", "auto", `cd apps/plain && ${PUSH}`, true],
  ["auto", "manual", `CDPATH=apps; cd x && ${PUSH}`, true], // the shell goes to apps/x
  // a cd that may not have moved what lands: the root is judged too
  ["manual", "auto", `cd $X && ${PUSH}`, true],
  ["manual", "auto", `pushd -n apps/x && ${PUSH}`, true],
  ["manual", "auto", `popd apps/x; ${PUSH}`, true],
  ["manual", "auto", `(cd apps/x) && ${PUSH}`, true],
  ["manual", "auto", `(cd apps/x; true) && ${PUSH}`, true],
  ["manual", "auto", `cd apps/x | true; ${PUSH}`, true],
  ["manual", "auto", `true | cd apps/x; ${PUSH}`, true],
  ["manual", "auto", `cd apps/x & ${PUSH}`, true],
  ["manual", "auto", `false && cd apps/x; ${PUSH}`, true],
  ["manual", "auto", `if false; then cd apps/x; fi; ${PUSH}`, true],
  ["manual", "auto", `env cd apps/x && ${PUSH}`, true],
  ["manual", "auto", `bash -c 'cd apps/x' && ${PUSH}`, true],
  ["manual", "auto", `echo $(cd apps/x) && ${PUSH}`, true],
  ["manual", "auto", `echo $(cd apps/x; true) && ${PUSH}`, true],
  ["manual", "auto", `echo \`cd apps/x; true\` && ${PUSH}`, true],
  ["manual", "auto", `find . -maxdepth 0 -exec cd apps/x \\; ; ${PUSH}`, true],
  ["manual", "auto", `f() { cd apps/x; }; ${PUSH}`, true],
  // ...and where every candidate is auto, nothing is held
  ["auto", "auto", `(cd apps/x && ${PUSH})`, false],
  ["auto", "auto", `true && cd apps/x && ${PUSH}`, false],
];

Deno.test("guard-merge: a landing after a cd is judged by the cd target's merge mode", async () => {
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

Deno.test("guard-merge: the hold after a cd names the cd target's base branch", async () => {
  const sb = await sandbox();
  try {
    const root = await makeRepo(sb, { mode: "auto", head: "feat" });
    await Deno.mkdir(`${root}/apps`);
    await Deno.rename(await makeRepo(sb, { head: "feat", base: "trunk" }), `${root}/apps/x`);
    for (const harness of HARNESSES) {
      const r = await bash(sb, harness, root, `cd apps/x && ${PUSH}`);
      assertEquals(verdict(r), GATED[harness], r.stderr);
      assertEquals(r.stderr.includes("Landing on the base branch (trunk)"), true, r.stderr);
    }
  } finally {
    await sb.cleanup();
  }
});
