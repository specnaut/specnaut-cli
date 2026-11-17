// What the change set and the protected paths are read from: the objects their ids name, and
// entries no file name can forge. A path that cannot be compared as text widens, alike on both twins.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { FULL_MARKS, scoped } from "./gate_impact_case.ts";
import { CHECKOUT_CONFIG } from "./gate_impact_corpus_checkout.ts";
import { declaration, impactRepo, labelled, type Repo } from "./gate_impact_fixture.ts";
import { gateProject, runGate, spawn, TWINS } from "./run_gate_fixture.ts";

const SCRIPTS = fromFileUrl(new URL("../../templates/core/specnaut/scripts/", import.meta.url));
// A Windows checkout cannot hold a name with a newline, nor index one that is not UTF-8.
const WINDOWS = Deno.build.os === "windows";

/**
 * Commits a file whose name `printf` builds from `escaped` (`\377` is one byte that is not
 * UTF-8), as an index entry git never checks out: some file systems refuse such a name, and the
 * graph reads only what git's objects hold.
 */
async function commitUnwritable(repo: Repo, escaped: string): Promise<string> {
  const plant = `name="$(printf "$1")"; blob="$(printf 'x\\n' | git hash-object -w --stdin)" &&
    printf '100644 %s\\t%s\\0' "$blob" "$name" | git update-index -z --index-info &&
    printf '%s\\0' "$name" | git update-index -z --skip-worktree --stdin`;
  const r = await spawn(["bash", "-c", plant, "plant", escaped], repo.root);
  assertEquals(r.code, 0, r.stderr);
  return repo.commit();
}

const codeOf = async (file: string) =>
  (await Deno.readTextFile(join(SCRIPTS, file))).split("\n")
    .filter((l) => !l.trim().startsWith("#")).join("\n");

/** The function `opening` starts, up to its closing brace in column 1. */
const bodyOf = (code: string, opening: string) => {
  const start = code.indexOf(opening);
  assert(start >= 0, `${opening} not found`);
  const end = code.indexOf("\n}", start);
  assert(end >= 0, `${opening} has no closing brace in column 1`);
  return code.slice(start, end);
};

for (const twin of TWINS) {
  Deno.test({
    name: `gate impact (${twin}): a protected file whose name holds a newline widens`,
    ignore: WINDOWS,
    fn: async () => {
      const files = { ".specnaut/scripts/bash/a\n100644 blob x\tb.sh": "x\n" };
      const repo = await impactRepo({ files });
      await repo.commit({ "apps/web/a.ts": "changed\n" });
      const r = await repo.gate(twin, ["fast", "--base", repo.main]);
      assertEquals(r.code, 0, r.stdout + r.stderr);
      assertEquals(labelled(r, "fallback"), ["protected-not-regular: .specnaut/scripts/"]);
    },
  });

  Deno.test({
    name:
      `gate impact (${twin}): a protected name that reads as two entries does not pass for them`,
    ignore: WINDOWS,
    fn: async () => {
      const files = { ".specnaut/scripts/a": "one\n", ".specnaut/scripts/b": "two\n" };
      const repo = await impactRepo({ files });
      const two = await repo.git("rev-parse", "HEAD:.specnaut/scripts/b");
      // Newline-joined, this one entry reads exactly as the base's `a` and `b`.
      const forged = `.specnaut/scripts/a\n100644 blob ${two}\t.specnaut/scripts/b`;
      await repo.commit({ [forged]: "one\n" }, [".specnaut/scripts/a", ".specnaut/scripts/b"]);
      const r = await repo.gate(twin, ["fast", "--base", repo.main]);
      assertEquals(r.code, 0, r.stdout + r.stderr);
      assertEquals(labelled(r, "fallback"), ["protected-not-regular: .specnaut/scripts/"]);
    },
  });

  Deno.test({
    name: `gate impact (${twin}): a protected name that is not UTF-8 is not compared`,
    ignore: WINDOWS,
    fn: async () => {
      const repo = await impactRepo();
      repo.main = await commitUnwritable(repo, ".specnaut/scripts/bad\\377.sh");
      await repo.git("branch", "-f", "main", repo.main);
      await repo.commit({ "apps/web/a.ts": "changed\n" });
      const r = await repo.gate(twin, ["fast", "--base", repo.main]);
      assertEquals(r.code, 0, r.stdout + r.stderr);
      assertEquals(labelled(r, "fallback"), ["protected-not-regular: .specnaut/scripts/"]);
      assertEquals(r.marks, FULL_MARKS);
    },
  });

  Deno.test(`gate impact (${twin}): a replace ref does not change what a base holds`, async () => {
    const repo = await impactRepo();
    const tip = await repo.commit({ "apps/web/a.ts": "changed\n" });
    // Read through the replacement, the base would hold the tip and nothing would differ.
    await repo.git("replace", repo.main, tip);
    const r = await repo.gate(twin, ["fast", "--base", repo.main]);
    assertEquals(r.code, 0, r.stdout + r.stderr);
    assertEquals(labelled(r, "scope"), ["owners web"], r.stdout);
    assertEquals(r.marks, scoped("web"));
  });

  // Every path is top-relative: a project below its work tree's top is refused, so a path its
  // declaration names is never compared with one git reports from the top.
  Deno.test(`gate impact (${twin}): a project inside another repository's tree is refused`, async () => {
    const outer = await impactRepo();
    const inner = join(outer.root, "nested");
    await Deno.mkdir(inner);
    const nested = await gateProject("fast_gate:\n  - echo should-not-run\n");
    await Deno.rename(join(nested, ".specnaut"), join(inner, ".specnaut"));
    await Deno.writeTextFile(join(inner, ".specnaut/impact.json"), JSON.stringify(declaration()));
    const r = await runGate(twin, inner, ["fast", "--base", "main"]);
    assertEquals(r.code, 3, r.stdout);
    assertStringIncludes(r.stdout, "candidate: refused (not-a-repository");
    assert(!r.stdout.includes("should-not-run"), r.stdout);
  });
}

// The differential: one repository, both twins, one answer. Each must name the cause, since two
// twins agreeing on a narrowed run would also be equal.
Deno.test({
  name: "gate impact: a changed path that is not UTF-8 widens on every twin, for the same cause",
  ignore: WINDOWS,
  fn: async () => {
    const repo = await impactRepo();
    await commitUnwritable(repo, "apps/web/bad\\377.ts");
    const reports = [];
    for (const twin of TWINS) {
      const r = await repo.gate(twin, ["fast", "--base", repo.main]);
      assertEquals(r.code, 0, `${twin}\n${r.stdout}${r.stderr}`);
      assertEquals(labelled(r, "fallback"), ["path-unreadable: apps/web/bad???.ts"], twin);
      assertEquals(r.marks, FULL_MARKS, twin);
      reports.push(r.report);
    }
    if (reports.length === 2) assertEquals(reports[1], reports[0], "the twins disagree");
  },
});

// No replace ref is obeyed: the graphs reach git only through the wrappers that pass
// --no-replace-objects, and read every tree whole, from its top.
Deno.test("the impact graphs run git only through the wrapper that obeys no replace ref", async () => {
  for (const file of ["bash/_gate_impact_graph.sh", "powershell/_gate_impact_graph.ps1"]) {
    const code = await codeOf(file);
    // A bare token, however it is quoted or followed: `git`, `'git',`, `('git')`, `git.exe`.
    assert(!/(^|[^\w-])['"]?git(\.exe)?['"]?(?![\w-])/m.test(code), `${file} runs git itself`);
    const lsTrees = code.split("\n").filter((l) => l.includes("ls-tree"));
    assert(lsTrees.length > 0, `${file} reads no tree`);
    for (const l of lsTrees) assertStringIncludes(l, "--full-tree", file);
  }
  const bash = bodyOf(await codeOf("bash/_gate_candidate.sh"), "gate_git() {");
  assertStringIncludes(bash, "--no-replace-objects");
  const pwsh = bodyOf(await codeOf("powershell/_gate_candidate.ps1"), "function Invoke-GateGit(");
  assertStringIncludes(pwsh, "'--no-replace-objects'");
});

// The root files that always widen live in one list per twin; both must name what the corpus runs.
Deno.test("the impact graphs widen on the same checkout-config files", async () => {
  const listOf = (code: string, around: RegExp) => {
    const list = code.match(around);
    assert(list, `${around} not found`);
    return [...list[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  };
  const jq = /def checkout_config\(\$p\):[^[]*\[([^\]]*)\]/;
  const ps = /function Test-GateCheckoutConfig\([^)]*\) \{[^@]*@\(([^)]*)\)/;
  const bash = listOf(await codeOf("bash/_gate_impact_graph.sh"), jq);
  const pwsh = listOf(await codeOf("powershell/_gate_impact_graph.ps1"), ps);
  assertEquals(pwsh, bash, "the twins hold different lists");
  assertEquals(bash, CHECKOUT_CONFIG, "the corpus does not run every name");
});
