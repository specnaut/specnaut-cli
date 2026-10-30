import { assertEquals } from "@std/assert";
import { assertMatch } from "@std/assert";
import { HARNESSES, makeRepo, pool, sandbox } from "./hook_sandbox.ts";
import { bash, GATED, verdict } from "./guard_merge_fixture.ts";

/**
 * cli#711 part B — the parser reads only what it can read with certainty;
 * every other form marks the line opaque, and the guard gates it (plan § 4:
 * unknown means opaque). Before this, each GATED row below ran a listed script
 * or a push to the base under `merge: manual` with no question. Pass 1: a
 * wrapper option that takes a value, a wrapper named by its path, a shell fed
 * on stdin, a string the shell evaluates later, a non-ASCII spelling a
 * case-folding filesystem resolves to the script. Pass 2: a case arm's `)`
 * closing a substitution, a substitution in an unquoted heredoc body, a word
 * the command fills in (xargs, its -I placeholder, find's `{}`), a zsh glob
 * qualifier that runs code — and the false gates of `if(`, `[[ … ]]` and
 * `command -v`.
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
  "/usr/bin/time -f %e land-feature.sh",
  "env -u HOME land-feature.sh",
  "sudo -R /x land-feature.sh",
  "exec --frob foo land-feature.sh",
  "/usr/bin/env land-feature.sh",
  `/usr/bin/env ${PUSH}`,
  "/usr/bin/nice land-feature.sh",
  "/usr/bin/time land-feature.sh",
  "/usr/bin/timeout 60 land-feature.sh",
  "bash --rcfile x.sh -c 'land-feature.sh'",
  "bash --rcfile land-feature.sh -ic 'echo hi'",
  "bash --init-file land-feature.sh -ic :",
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
  `bash /dev/fd/3 3<<<'${PUSH}'`,
  `source /dev/fd/0 <<<'${PUSH}'`,
  `sh /proc/self/fd/0 <<<'${PUSH}'`,
  `source <(echo ${PUSH})`,
  `sudo -s <<<'${PUSH}'`,
  `sudo -i <<<'${PUSH}'`,
  `trap '${PUSH}' EXIT`,
  `mapfile -C '${PUSH}' -c 1 < /etc/hosts`,
  `readarray -C '${PUSH}' -c 1 < /etc/hosts`,
  `let 'x=a[$(${PUSH})]'`,
  `printf -v 'a[$(${PUSH})]' x`,
  `printf -v 'a[\`${PUSH}\`]' x`,
  "echo ${(e)X}",
  `X='$(${PUSH})'; echo \${(e)X}`,
  "BASH_ENV=.specnaut/scripts/bash/land-feature.sh bash -c :",
  "ENV=land-feature.sh sh -i",
  "ENV=land-feature.sh sh -ic :", // sh -i alone is gated already: a shell on stdin
  // HIGH 2 — a case arm's `)` would close the substitution around it
  "echo $(case x in a) git merge main;; esac)",
  `echo $(case x in *) ${PUSH};; esac)`,
  'echo "$(case x in a) land-feature.sh;; esac)"',
  "echo $(if true; then case x in a) land-feature.sh;; esac; fi)",
  // HIGH 2 — an unquoted heredoc body runs its substitutions
  `cat <<EOF\n$(${PUSH})\nEOF`,
  "cat <<EOF\n`land-feature.sh`\nEOF",
  "cat <<-EOF\n\t$(land-feature.sh)\n\tEOF",
  // HIGH 3 — the command fills in a word: stdin (xargs), a placeholder
  "echo merge main | xargs git",
  "echo land-feature.sh | xargs -I X X",
  "echo merge | xargs -I X git X main",
  "echo merge | xargs -IX git X main",
  "echo merge | xargs -0I X git X main",
  "echo merge | xargs --replace git {} main",
  "find merge -maxdepth 0 -exec git {} main \\;",
  "find . -name land-feature.sh -exec {} \\;",
  'gh pr "$(echo merge)" 12',
  "gh $W 12", // W="pr merge": an unquoted word may be several
  "glab mr $M 1",
  "echo 12 | xargs gh pr",
  // MEDIUM 6 — the false-gate fixes still read what runs inside
  "if true; then(git push origin main); fi",
  "if(land-feature.sh); then :; fi",
  `[[ $(${PUSH}) ]]`,
  "[[ -n x && $(land-feature.sh) ]]",
  "[[ a ]] || land-feature.sh",
  "[[ a == b",
  // a zsh glob qualifier runs code for each file it matches
  `ls *(e:'${PUSH}':)`,
  "ls *(+fn)",
  "ls *(#qe:'land-feature.sh':)x",
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
  "echo ${(U)X}",
  "bash -euxo pipefail ./build.sh",
  // pass 2 — a quoted heredoc body is data; quoted text never opens a frame
  `cat <<'EOF'\n$(${PUSH})\nEOF`,
  'cat <<"EOF"\n`land-feature.sh`\nEOF',
  "cat <<\\EOF\n$(land-feature.sh)\nEOF",
  "cat <<EOF\nhello $USER, ${HOME}\nEOF",
  `git commit -m "$(cat <<'EOF'\nfeat: x $(y) \`z\` case [[ if(\nEOF\n)"`,
  "git commit -m 'case x in a) [[ $(y) ]] esac'",
  "git commit -m 'docs: [skip ci] use `x` and $(y)'",
  'git commit -m "fix(scope): use (e) here"',
  'echo "[[ a | b ]] if(x)"',
  // MEDIUM 6 — false gates: a reserved word before `(`, `[[ … ]]`, command -v
  "if(true); then echo; fi",
  "if true; then(echo hi); fi",
  "while(false); do :; done",
  "[[ $x =~ ^(a|b)$ ]] && echo ok",
  "[[ $x == a || $y == b ]]; echo",
  "[[ -n $x ]]&& echo ok",
  "[[ a < b ]] && echo",
  "if [[ $x =~ (a|b) ]]; then echo; fi",
  "command -v land-feature.sh",
  "command -V land-feature.sh",
  "ls *.(sh|md)",
  "ls *(.)",
  "echo hi | xargs echo",
  "echo x | xargs",
  "echo x | xargs -I {} cp {} /tmp",
  "gh pr view 12",
  "gh pr list --author @me",
  'gh pr view "$X"',
  "echo 12 | xargs gh pr view",
  // a git subcommand outside cmd_git's list that is no alias: `config --get`
  // exits 1, which the ERR trap inside `$(…)` used to turn into 2 — "an alias
  // it cannot follow", so every one of these was gated
  "git remote -v",
  "git worktree list",
  "git describe --tags",
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

/**
 * HIGH 5 — a byte outside printable ASCII in a command word gates it (APFS
 * folds `ſ`, U+017F, to `s`, so `land-feature.ſh` runs the script). That
 * holds only because _guard.sh sets LC_ALL=C: under UTF-8, `ſ` is
 * `[[:print:]]`. The sandbox pins LC_ALL=C for every child, so these rows run
 * under the UTF-8 locale a user's shell has — where they fail if the guard
 * stops setting its own.
 */
const NON_ASCII: ReadonlyArray<[command: string, gated: boolean]> = [
  ["land-feature.ſh", true],
  ["bash .specnaut/scripts/bash/land-feature.ſh", true],
  ["echo café", false],
];

/** The first UTF-8 locale bash has here: one where `ſ` is one character, not two bytes. */
async function utf8Locale(env: Record<string, string>): Promise<string> {
  for (const loc of ["C.UTF-8", "en_US.UTF-8", "C.utf8"]) {
    const out = await new Deno.Command("bash", {
      args: ["-c", 'x=$1; printf %s "${#x}"', "_", "ſ"],
      env: { ...env, LC_ALL: loc },
      clearEnv: true,
      stderr: "null",
    }).output();
    if (new TextDecoder().decode(out.stdout) === "1") return loc;
  }
  throw new Error("no UTF-8 locale: the non-ASCII rows would pass under C, for the wrong reason");
}

Deno.test("guard-merge: a non-ASCII command word is gated under a UTF-8 locale too", async () => {
  const sb = await sandbox();
  try {
    const utf8 = { ...sb, env: { ...sb.env, LC_ALL: await utf8Locale(sb.env) } };
    const manual = await makeRepo(sb, { head: "feat" });
    const auto = await makeRepo(sb, { head: "feat", mode: "auto" });
    const cases = [sb, utf8].flatMap((box) =>
      HARNESSES.flatMap((h) =>
        NON_ASCII.flatMap(([c, gated]) =>
          [[box, h, manual, c, gated], [box, h, auto, c, false]] as const
        )
      )
    );
    const got = await pool(cases, ([box, h, repo, command]) => bash(box, h, repo, command));
    const wrong = cases.flatMap(([box, h, repo, command, gated], i) => {
      const want = gated ? GATED[h] : "allow";
      const v = verdict(got[i]);
      const where = `${box.env.LC_ALL} ${repo === manual ? "manual" : "auto"}`;
      return v === want
        ? []
        : [`${h} [${where}] ${JSON.stringify(command)}: want ${want}, got ${v}`];
    });
    assertEquals(wrong, [], wrong.join("\n"));
  } finally {
    await sb.cleanup();
  }
});

Deno.test("guard-merge: a crash on Codex is not read as a deny", async () => {
  // Both exit 2. A payload of the wrong shape stops the guard before it reads
  // the command; `verdict` must say so, or every Codex "deny" row above would
  // pass on a guard that crashed (cli#711).
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { head: "feat" });
    const crash = await bash(sb, "codex", repo, "", { tool_input: { command: 42 } });
    assertMatch(
      String(verdict(crash)),
      /^unexpected exit 2: [\s\S]*not of the shape this hook reads/,
    );
    assertMatch(String(verdict(await bash(sb, "codex", repo, PUSH))), /^deny$/);
  } finally {
    await sb.cleanup();
  }
});
