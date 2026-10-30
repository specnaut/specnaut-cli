import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { HARNESSES, payload, pool, runHook, sandbox } from "./hook_sandbox.ts";
import { C, HOOK, project, SELF, UI, verdict } from "./constitution_fixture.ts";

/**
 * Spec 038 § 11 S1 — the Bash arm of protect-constitution.sh. A bare read goes
 * through; every other command naming a guarded file is judged, through each
 * way past a name-only allowlist the security seat listed. A commit message or
 * branch name that merely says "constitution" names nothing.
 */

/** Commands that write a guarded file, each a way past a name-only allowlist (S1). */
const WRITES: readonly string[] = [
  `git diff --output=${C} HEAD`,
  `git log --output ${C}`,
  `git -c diff.external=./x.sh diff ${C}`,
  `git diff --ext-diff ${C}`,
  `git show --textconv HEAD:${C}`,
  `git add -p ${C}`,
  `git add -e ${C}`,
  `git add --patch ${C}`,
  `git add -vp ${C}`,
  `GIT_EXTERNAL_DIFF=./x.sh git diff ${C}`,
  `PATH=./bin:$PATH; cat ${C}`,
  `/x/cat ${C}`,
  `./cat ${C}`,
  `cat() { cp src/a.ts "$1"; }; cat ${C}`,
  `function cat { cp src/a.ts "$1"; }; cat ${C}`,
  `alias cat=tee; cat ${C}`,
  // A function on the line makes every command word suspect, even a read's.
  `f() { :; }; cat ${C}`,
  `cp src/a.ts docs/consti*.md`,
  `cp src/a.ts docs/*`,
  `cp src/a.ts d?cs/constitution.md`,
  `cp src/a.ts docs/[c]onstitution.md`,
  `cp src/a.ts docs/constitution.{md,bak}`,
  `cp src/a.ts "$D/constitution.md"`,
  `cp src/a.ts "\${D}/constitution.md"`,
  `F=${C}; cp src/a.ts "$F"`,
  `for f in $(grep -l x ${C}); do sed -i s/x/y/ "$f"; done`,
  `echo x > ${C}`,
  `echo x >${C}`,
  `cat src/a.ts >> ${C}`,
  `printf x 1>${C}`,
  `echo x &> ${C}`,
  `echo x >| ${C}`,
  `> ${C}`,
  `echo x > ${UI}`,
  `cat ${C} | tee ${C}`,
  `sed -i s/x/y/ ${C}`,
  `mv src/a.ts ${C}`,
  `rm ${C}`,
  `git checkout -- ${C}`,
  `git restore ${C}`,
  `cp src/a.ts DOCS/Constitution.MD`,
  `cd docs && cp ../src/a.ts constitution.md`,
  `cd docs && cp ../src/a.ts CONSTITUTION.MD`,
  `cp src/a.ts rules-link`,
  `cp src/a.ts rules-hardlink`,
  `rg --pre ./x.sh x ${C}`,
  `python3 -c "open('${C}','w')"`,
  `python3 -c "open('docs/' + 'constitution' + '.md','w')"`,
  `perl -pi -e s/x/y/ ${C}`,
  `node -e "require('fs').writeFileSync(process.argv[1], '')" ${C}`,
  `eval "cp src/a.ts ${C}"`,
  `bash -c 'cp src/a.ts ${C}'`,
  `sh -c "echo > ${C}"`,
  `awk '{ print > "${C}" }' src/a.ts`,
  `dd if=src/a.ts of=${C}`,
  `dd if=src/a.ts of=rules-link`,
  `cp src/a.ts ${SELF}`,
  `echo > .specnaut/hooks/protect-constitution.sh`,
  // cli#704: a redirection glued to the word before it is still one, and an
  // escape in $'…' is a byte the shell computes, never a way to spell the name.
  `cat src/a.ts>${C}`,
  `cat src/a.ts>>${C}`,
  `head -c0 src/a.ts>${C}`,
  `cat src/a.ts&>${C}`,
  `grep x src/a.ts>|${C}`,
  `cat src/a.ts 2>${C}`,
  `cat src/a.ts"x">${C}`,
  `cat src/a.ts > $'docs/constitution\\x2emd'`,
  `cp src/a.ts $'docs/constitution\\x2emd'`,
  `cp src/a.ts $'docs/\\143onstitution.md'`,
  `tee $'docs/constitution\\56md' < src/a.ts`,
];

/** Reads, and commands that mention the word without naming the file: never gated. */
const READS: readonly string[] = [
  `cat ${C}`,
  `head -n 5 ${C}`,
  `tail -3 ${C}`,
  `grep -n Check ${C}`,
  `grep -rn constitution docs/`,
  `wc -l ${C}`,
  `diff ${C} src/a.ts`,
  `git diff ${C}`,
  `git diff --stat -- ${C}`,
  `git log -p -- ${C}`,
  `git show HEAD:${C}`,
  `git blame ${C}`,
  `git status ${C}`,
  `git add ${C}`,
  `git add -A`,
  `cat ${C} | wc -l`,
  `cat < ${C}`,
  `cat ${C} > src/copy.md`,
  `cat ${UI} .specnaut/size-limits.yml`,
  `cat ${SELF}`,
  `if grep -q Check ${C}; then echo yes; fi`,
  `{ cat ${C}; } | wc -l`,
  `{ echo hi; } && cat ${C}`,
  `git commit -m "docs: amend the constitution"`,
  `git commit -m "constitution: tighten the checks"`,
  `git checkout -b 038-project-constitution`,
  `git switch -c constitution-v2`,
  `git push -u origin constitution-v2`,
  `git commit -F - <<'EOF'\nconstitution: bump to 1.1.0\nEOF`,
  `for f in src/*.ts; do echo "$f"; done`,
  `echo "$HOME" && ls`,
  `cp src/a.ts src/b.ts`,
  `cp src/a.ts docs/other.md`,
  `cp src/a.ts docs/constitution.md.bak`,
  `deno fmt src/`,
  `cat ${C} 2>/dev/null`,
  `grep -c x ${C}>/dev/null`,
  `grep $'\\t' ${C}`,
  `cat ${C} | head -n $((2>1))`,
  // A glob's * stays inside one path component, as the shell's does.
  `deno fmt *.md`,
];

Deno.test("protect-constitution's Bash arm: every S1 bypass is judged, reads go through", async () => {
  const sb = await sandbox();
  try {
    const repo = await project(sb);
    // [command, the cwd under the repo, want]: a glob is expanded from the cwd.
    const cases = [
      ...WRITES.map((c) => [c, "", "deny"] as const),
      ...READS.map((c) => [c, "", "allow"] as const),
      ["cp ../src/a.ts c*.md", "docs", "deny"] as const,
      ["cp a.ts ../docs/c*.md", "src", "deny"] as const,
      ["cp a.ts *.md", "src", "allow"] as const,
      ["touch new.sh", ".specnaut/hooks", "deny"] as const,
      ["touch new.sh", "src", "allow"] as const,
    ].flatMap(([c, sub, want]) => HARNESSES.map((h) => [h, c, sub, want] as const));
    const wrong = (await pool(cases, async ([h, command, sub, want]) => {
      const cwd = join(repo, sub);
      const p = await payload(h, "pre_tool_use_bash", { cwd, tool_input: { command } });
      const r = await runHook(sb, HOOK, h, p);
      const got = verdict(r);
      return got === want ? "" : `${h} ${JSON.stringify(command)}: want ${want}, got ${got}`;
    })).filter((x) => x !== "");
    assertEquals(wrong, [], wrong.join("\n"));
  } finally {
    await sb.cleanup();
  }
});
