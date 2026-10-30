import { assertEquals } from "@std/assert";
import { HARNESSES, makeRepo, pool, sandbox } from "./hook_sandbox.ts";
import { bash, GATED, verdict } from "./guard_merge_fixture.ts";

/**
 * Spec 048 § 8 F2(b) — the landing scripts' hold finds the user's approval
 * through the session id the harness exports (CLAUDE_CODE_SESSION_ID,
 * CODEX_SESSION_ID) and the state dir (XDG_STATE_HOME). A line that sets or
 * clears any of them, or empties the environment (`env -i`), would send
 * merge-hold.sh to another stamp, or to none — so the parser marks it opaque,
 * and guard-merge gates it under manual. HOME is left out: too common.
 */

const LAND = "bash .specnaut/scripts/bash/land-feature.sh";

/** Gated under manual, allowed under auto. */
const GATED_FORMS: readonly string[] = [
  "CLAUDE_CODE_SESSION_ID= ls",
  `CLAUDE_CODE_SESSION_ID=x ${LAND}`,
  "CODEX_SESSION_ID=x ls",
  "XDG_STATE_HOME=/tmp/forged ls",
  "XDG_STATE_HOME+=/x ls",
  "CLAUDE_CODE_SESSION_ID=; ls",
  "export CLAUDE_CODE_SESSION_ID=x",
  "export -n CODEX_SESSION_ID",
  "declare -x XDG_STATE_HOME=/tmp/forged",
  "typeset +x CLAUDE_CODE_SESSION_ID",
  "readonly CODEX_SESSION_ID=x",
  "unset CLAUDE_CODE_SESSION_ID",
  "unset -v CODEX_SESSION_ID",
  "unset FOO XDG_STATE_HOME",
  "env -u CLAUDE_CODE_SESSION_ID ls",
  "env -uCODEX_SESSION_ID ls",
  "env -vu XDG_STATE_HOME ls",
  "env --unset=CLAUDE_CODE_SESSION_ID ls",
  "env --unset CODEX_SESSION_ID ls",
  "env XDG_STATE_HOME=/tmp/forged ls",
  "env -i ls",
  "env -i PATH=/usr/bin ls",
  "env -vi ls",
  "env - ls",
  "env --ignore-environment ls",
  "env -i -u HOME ls",
  "bash -c 'unset CLAUDE_CODE_SESSION_ID; ls'",
  "echo $(env -i ls)",
  // An assignment prefix with `+=` is one too: bash runs `FOO+=1 git push`
  // as a push. It used to be read as a command named `FOO+=1`.
  "FOO+=1 git push origin main",
  "GIT_DIR+=/x git push origin feat",
];

/** Allowed in both modes: the same commands on another variable, or reading these. */
const ALLOWED_FORMS: readonly string[] = [
  "unset FOO",
  "unset -v FOO BAR",
  "env -u FOO ls",
  "env -uFOOi ls",
  "env --unset=FOO ls",
  "env --unset FOO ls",
  "env -u FOO -u BAR ls",
  "env -v ls",
  "env -C /tmp/ix ls",
  "XDG_CONFIG_HOME=x ls",
  "XDG_STATE_HOMEX=x ls",
  "FOO+=1 ls",
  "export FOO=1",
  "declare -x BAR",
  "echo $CLAUDE_CODE_SESSION_ID $CODEX_SESSION_ID",
  'printf "%s\\n" "$XDG_STATE_HOME"',
  "printenv CLAUDE_CODE_SESSION_ID",
];

Deno.test("guard-merge: a line that changes what the landing hold reads is gated under manual", async () => {
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
