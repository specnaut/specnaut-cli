import { assertEquals } from "@std/assert";
import { HARNESSES, makeRepo, pool, sandbox } from "./hook_sandbox.ts";
import { bash, GATED, verdict } from "./guard_merge_fixture.ts";

/**
 * cli#711 part B, pass 1 — the parser reads only what it can read with
 * certainty; every other form marks the line opaque, and the guard gates it
 * (plan § 4: unknown means opaque). Before this, each GATED row below ran a
 * listed script or a push to the base under `merge: manual` with no question:
 * a wrapper option that takes a value, a wrapper named by its path, a shell
 * fed on stdin, a string the shell evaluates later, a non-ASCII spelling a
 * case-folding filesystem resolves to the script.
 */

const PUSH = "git push origin main";

/** Gated under manual, allowed under auto. */
const GATED_FORMS: readonly string[] = [
  // HIGH 1 — wrappers: their options, their path, the prefix words
  "exec -a foo land-feature.sh",
  "env -S 'land-feature.sh x'",
  "env --split-string='land-feature.sh x'",
  "env -P /usr/bin land-feature.sh",
  "nice --adjustment 5 land-feature.sh",
  `nice -n 5 -- ${PUSH}`,
  "sudo -T 10 land-feature.sh",
  "/usr/bin/time -o out land-feature.sh",
  "/usr/bin/env land-feature.sh",
  `/usr/bin/env ${PUSH}`,
  "/usr/bin/nice land-feature.sh",
  "/usr/bin/time land-feature.sh",
  "/usr/bin/timeout 60 land-feature.sh",
  "bash --rcfile x.sh -c 'land-feature.sh'",
  "bash -euxo pipefail land-feature.sh",
  "coproc land-feature.sh",
  "nocorrect land-feature.sh",
  "repeat 1 land-feature.sh",
  `function f { ${PUSH}; }; f`,
  "function f g { land-feature.sh; }; f",
  // HIGH 4 — a shell fed on stdin, and strings the shell evaluates later
  `source /dev/stdin <<<'${PUSH}'`,
  `bash /dev/stdin <<<'${PUSH}'`,
  `bash -s x <<<'${PUSH}'`,
  `source <(echo ${PUSH})`,
  `sudo -s <<<'${PUSH}'`,
  `trap '${PUSH}' EXIT`,
  `mapfile -C '${PUSH}' -c 1 < /etc/hosts`,
  `let 'x=a[$(${PUSH})]'`,
  `printf -v 'a[$(${PUSH})]' x`,
  "echo ${(e)X}",
  `X='$(${PUSH})'; echo \${(e)X}`,
  "BASH_ENV=.specnaut/scripts/bash/land-feature.sh bash -c :",
  // HIGH 5 — a non-ASCII byte in the command word (APFS folds `ſ` to `s`)
  "land-feature.ſh",
  "bash .specnaut/scripts/bash/land-feature.ſh",
];

/** Allowed in both modes: forms proven to run nothing listed. */
const ALLOWED_FORMS: readonly string[] = [
  "command -p ls",
  "builtin echo hi",
  ". ./x.sh",
  "cat < <(echo hi)",
  "cat <<<$(date)",
  "echo $'a\\tb'",
  "echo {a,b}",
  "exec -a foo ls",
  "exec -a land-feature.sh ls",
  "nice ls",
  "nice -n 5 ls",
  "env FOO=1 ls",
  "env -i -u HOME ls",
  "/usr/bin/env ls",
  "/usr/bin/time -p ls",
  "sudo -u root ls",
  "trap - EXIT",
  "trap '' INT",
  "mapfile -t lines < /etc/hosts",
  "echo café",
  "bash -euxo pipefail ./build.sh",
];

Deno.test("guard-merge: a form the parser cannot read with certainty is gated under manual", async () => {
  const sb = await sandbox();
  try {
    const manual = await makeRepo(sb, { head: "feat" });
    const auto = await makeRepo(sb, { head: "feat", mode: "auto" });
    const cases = HARNESSES.flatMap((h) => [
      ...GATED_FORMS.flatMap((c) => [[h, manual, c, true], [h, auto, c, false]] as const),
      ...ALLOWED_FORMS.flatMap((c) => [[h, manual, c, false], [h, auto, c, false]] as const),
    ]);
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
