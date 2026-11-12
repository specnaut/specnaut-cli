// FR-011 and FR-012: what a selected command is handed, what every activated run prints,
// and the evidence it leaves. Nothing reads the evidence to decide anything, so a stale
// or planted file is shown to change nothing.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { impactRepo, labelled } from "./gate_impact_fixture.ts";
import { TWINS } from "./run_gate_fixture.ts";

const SCRIPTS = fromFileUrl(new URL("../../templates/core/specnaut/scripts/", import.meta.url));

for (const twin of TWINS) {
  const evidencePath = async (repo: Awaited<ReturnType<typeof impactRepo>>, tier: string) => {
    const tree = await repo.git("rev-parse", "HEAD^{tree}");
    return join(
      repo.root,
      await repo.git("rev-parse", "--git-path", `specnaut/gate-evidence/${tier}-${tree}.json`),
    );
  };

  Deno.test(`gate impact (${twin}): every label is printed, ASCII only, whatever the outcome`, async () => {
    const repo = await impactRepo();
    await repo.commit({ "apps/web/a.ts": "changed\n" });
    const r = await repo.gate(twin, ["fast", "--base", repo.main]);
    assertEquals(r.code, 0, r.stderr);
    for (
      const label of ["candidate", "scope", "ran", "omitted", "fallback", "removed", "evidence"]
    ) {
      assert(labelled(r, label).length > 0, `${label} missing:\n${r.stdout}`);
    }
    const tree = await repo.git("rev-parse", "HEAD^{tree}");
    const commit = await repo.git("rev-parse", "HEAD");
    assertEquals(labelled(r, "candidate"), [`tree=${tree} commit=${commit}`]);
    assertEquals(labelled(r, "omitted"), ["none"]);
    assertEquals(labelled(r, "removed"), ["none"]);
    const lines = r.stdout.split("\n").filter((l) =>
      /^(candidate|scope|ran|omitted|fallback|removed|evidence): /.test(l)
    );
    for (const line of lines) assert(/^[\x20-\x7e\r]*$/.test(line), line);
  });

  Deno.test(`gate impact (${twin}): omitted names the command and why`, async () => {
    const repo = await impactRepo();
    await repo.commit({ "docs/guide.md": "changed\n" });
    const r = await repo.gate(twin, ["fast", "--base", repo.main]);
    assertEquals(labelled(r, "omitted"), [
      "bash tools/mark.sh web-only (owners-not-affected: web)",
    ]);
  });

  Deno.test(`gate impact (${twin}): the owners reach the variable, and no inherited one survives`, async () => {
    const repo = await impactRepo();
    await repo.commit({ "apps/web/a.ts": "changed\n" });
    const r = await repo.gate(twin, ["fast", "--base", repo.main], {
      env: { SPECNAUT_AFFECTED_OWNERS: "planted-by-the-caller" },
    });
    assertEquals(r.marks, ["suite-scoped web", "web-scoped web", "always unset"]);
  });

  Deno.test(`gate impact (${twin}): a selected command is not handed the caller's stdin`, async () => {
    const repo = await impactRepo({
      gates: "fast_gate:\n  - bash tools/read.sh\n",
      files: { "tools/read.sh": '#!/usr/bin/env bash\ncat >"$READ_SEEN"\n' },
    });
    await repo.commit({ "apps/web/a.ts": "changed\n" });
    const seen = join(repo.outside, "read-seen");
    const r = await repo.gate(twin, ["fast", "--base", repo.main], {
      stdin: "data the caller piped in\n",
      env: { READ_SEEN: seen.replaceAll("\\", "/") },
    });
    assertEquals(r.code, 0, r.stdout + r.stderr);
    assertStringIncludes(r.stdout, "ran: bash tools/read.sh (exit 0)");
    assertEquals(await Deno.readTextFile(seen), "");
  });

  const narrowedEvidence = async () => {
    const repo = await impactRepo();
    const commit = await repo.commit({ "docs/guide.md": "changed\n" });
    const r = await repo.gate(twin, ["fast", "--base", repo.main]);
    assertEquals(r.code, 0, r.stderr);
    const path = await evidencePath(repo, "fast");
    return { repo, commit, path, e: JSON.parse(await Deno.readTextFile(path)) };
  };

  Deno.test(`gate impact (${twin}): the evidence names the candidate and its outcome, atomically`, async () => {
    const { repo, commit, path, e } = await narrowedEvidence();
    assertEquals(e.tier, "fast");
    assertEquals(e.commit, commit);
    assertEquals(e.result, "passed");
    assertEquals(e.valid, true);
    assertEquals(e.bases, [repo.main]);
    assertEquals(e.scope, "owners");
    assertEquals(e.owners, ["guide"]);
    assertEquals(e.fallback, []);
    const names = [];
    for await (const f of Deno.readDir(dirname(path))) names.push(f.name);
    assertEquals(names.filter((n) => n.startsWith(".evidence")), [], "a temporary file stayed");
  });

  Deno.test(`gate impact (${twin}): the evidence records what ran, what did not, and what was trusted`, async () => {
    const { e } = await narrowedEvidence();
    assertEquals(e.ran.map((x: { command: string; exit: number }) => [x.command, x.exit]), [
      ["bash tools/mark.sh suite-scoped", 0],
      ["bash tools/mark.sh always", 0],
    ]);
    assertEquals(e.ran[0].owners, ["guide"]);
    assertEquals(e.ran[1].owners, []);
    assertEquals(e.omitted, [{
      reason: "owners-not-affected: web",
      command: "bash tools/mark.sh web-only",
    }]);
    assertEquals(e.trusted.adapter, "bash tools/impact-adapter.sh");
    assertEquals(e.trusted.scoped, ["bash tools/mark.sh suite-scoped"]);
  });

  Deno.test(`gate impact (${twin}): the last line of a pass names its scope`, async () => {
    const repo = await impactRepo();
    await repo.commit({ "apps/web/a.ts": "changed\n" });
    const narrowed = await repo.gate(twin, ["fast", "--base", repo.main]);
    assertStringIncludes(
      narrowed.stdout,
      "the fast gate passed (scope: owners web) - 3 command(s) ran, 0 omitted",
    );
    await repo.commit({ "stray.txt": "x\n" });
    const widened = await repo.gate(twin, ["fast", "--base", repo.main]);
    assertStringIncludes(
      widened.stdout,
      "the fast gate passed (scope: full) - 3 command(s) ran, 0 omitted",
    );
  });

  Deno.test(`gate impact (${twin}): the evidence of a widened run names its cause and what went`, async () => {
    const repo = await impactRepo();
    await repo.commit({ ".specnaut/gates.yml": "fast_gate:\n  - bash tools/mark.sh always\n" });
    const r = await repo.gate(twin, ["fast", "--base", repo.main]);
    assertEquals(r.code, 0, r.stderr);
    const e = JSON.parse(await Deno.readTextFile(await evidencePath(repo, "fast")));
    assertEquals(e.scope, "full");
    assertEquals(e.fallback, ["protected-changed: .specnaut/gates.yml"]);
    assertEquals(e.removed, ["bash tools/mark.sh suite", "bash tools/mark.sh web-only"]);
    assertEquals(labelled(r, "removed"), [
      "bash tools/mark.sh suite",
      "bash tools/mark.sh web-only",
    ]);
  });

  Deno.test(`gate impact (${twin}): evidence that cannot be written changes nothing about the result`, async () => {
    const repo = await impactRepo();
    await repo.commit({ "apps/web/a.ts": "changed\n" });
    await Deno.writeTextFile(join(repo.root, ".git/specnaut"), "a file where a directory goes\n");
    const r = await repo.gate(twin, ["fast", "--base", repo.main]);
    assertEquals(r.code, 0, r.stdout + r.stderr);
    assert(labelled(r, "evidence")[0].startsWith("unwritten ("), r.stdout);
    assertEquals(r.marks.length, 3);
  });

  Deno.test(`gate impact (${twin}): a directory where the evidence goes leaves no temporary file`, async () => {
    const repo = await impactRepo();
    await repo.commit({ "apps/web/a.ts": "changed\n" });
    const path = await evidencePath(repo, "fast");
    await Deno.mkdir(path, { recursive: true });
    const r = await repo.gate(twin, ["fast", "--base", repo.main]);
    assertEquals(r.code, 0, r.stdout + r.stderr);
    assertEquals(labelled(r, "evidence"), ["unwritten (cannot-write-file)"]);
    const names = [];
    for await (const f of Deno.readDir(dirname(path))) names.push(f.name);
    assertEquals(names.filter((n) => n.startsWith(".evidence")), [], "a temporary file stayed");
    assertEquals(
      (await Array.fromAsync(Deno.readDir(path))).length,
      0,
      "it moved into the directory",
    );
  });

  Deno.test(`gate impact (${twin}): a post-run drift marks the evidence invalid`, async () => {
    const repo = await impactRepo({
      gates: "fast_gate:\n  - bash tools/leave.sh\n",
      files: { "tools/leave.sh": "#!/usr/bin/env bash\necho x >left-behind\n" },
    });
    await repo.commit({ "apps/web/a.ts": "changed\n" });
    const path = await evidencePath(repo, "fast");
    const r = await repo.gate(twin, ["fast", "--base", repo.main]);
    assertEquals(r.code, 3, r.stdout);
    const e = JSON.parse(await Deno.readTextFile(path));
    assertEquals(e.valid, false);
    assertEquals(e.result, "invalid");
  });

  Deno.test(`gate impact (${twin}): planted evidence skips nothing`, async () => {
    const repo = await impactRepo();
    await repo.commit({ "apps/web/a.ts": "changed\n" });
    const path = await evidencePath(repo, "fast");
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, JSON.stringify({ result: "passed", valid: true, ran: [] }));
    const r = await repo.gate(twin, ["fast", "--base", repo.main]);
    assertEquals(r.marks, ["suite-scoped web", "web-scoped web", "always unset"]);
    const e = JSON.parse(await Deno.readTextFile(path));
    assertEquals(e.ran.length, 3);
  });
}

// Culture rules read a zero-width character as nothing, so these spellings would make two
// different paths the same one. Comparison in the twin goes through Test-GateSame.
Deno.test("the PowerShell twin compares ordinally: no culture-bound comparison in its code", async () => {
  for (const file of FILES.powershell) {
    const text = await Deno.readTextFile(join(SCRIPTS, "powershell", file));
    const code = text.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    assertEquals(
      code.match(/-c(eq|ne|like|contains|notcontains)\b|Sort-Object|-(eq|ne) ''/g),
      null,
      file,
    );
  }
});

// The decision table, held by a sweep: each rule has one home, and a second spelling
// of it in a sibling file would drift from the first.
const FILES = {
  bash: [
    "run-gate.sh",
    "gate-impact.sh",
    "_gate_candidate.sh",
    "_gate_impact_read.sh",
    "_gate_impact_adapter.sh",
    "_gate_impact_graph.sh",
    "_gate_evidence.sh",
    "_gate_selected.sh",
    "_gate_sandbox.sh",
  ],
  powershell: [
    "run-gate.ps1",
    "gate-impact.ps1",
    "_gate_candidate.ps1",
    "_gate_impact_read.ps1",
    "_gate_impact_adapter.ps1",
    "_gate_impact_graph.ps1",
    "_gate_evidence.ps1",
    "_gate_selected.ps1",
  ],
};

async function holders(shell: "bash" | "powershell", pattern: RegExp): Promise<string[]> {
  const out = [];
  for (const file of FILES[shell]) {
    const text = await Deno.readTextFile(join(SCRIPTS, shell, file));
    const code = text.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    if (pattern.test(code)) out.push(file.replace(/\.(sh|ps1)$/, ""));
  }
  return out;
}

for (const shell of ["bash", "powershell"] as const) {
  const homes: [string, RegExp, string[]][] = [
    ["status is read", /['"\s]status['"]?,?\s+['"]?--porcelain/, ["_gate_candidate"]],
    ["a tree is resolved", /\^\{tree\}/, ["_gate_candidate"]],
    ["the change set is read", /diff-tree/, ["_gate_impact_graph"]],
    ["a worktree is added", /worktree['"]?,?\s+['"]?add/, ["_gate_impact_adapter"]],
    ["evidence is named", /gate-evidence/, ["_gate_evidence"]],
    ["an omission is recorded", /record omit |@\('omit'/, ["gate-impact"]],
    ["a selection record is written", /record run |@\('run'/, ["gate-impact"]],
  ];
  for (const [what, pattern, expected] of homes) {
    Deno.test(`the decision table (${shell}): only its home says how ${what}`, async () => {
      assertEquals(await holders(shell, pattern), expected);
    });
  }
}

Deno.test("the decision table (bash): the resolver family holds no parser and no eval", async () => {
  for (const file of FILES.bash.filter((f) => f !== "run-gate.sh")) {
    const text = await Deno.readTextFile(join(SCRIPTS, "bash", file));
    const code = text.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    assert(!/\beval\b/.test(code), `${file} holds an eval`);
    assert(!/\bawk\b/.test(code), `${file} holds an awk`);
  }
  assertStringIncludes(
    await Deno.readTextFile(join(SCRIPTS, "bash", "run-gate.sh")),
    "awk -v key=",
  );
});

Deno.test("the decision table (powershell): the resolver family holds no expression runner", async () => {
  for (const file of FILES.powershell.filter((f) => f !== "run-gate.ps1")) {
    const text = await Deno.readTextFile(join(SCRIPTS, "powershell", file));
    const code = text.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    assert(!/Invoke-Expression/.test(code), `${file} holds an expression runner`);
    assert(!/_gate:/.test(code), `${file} reads a tier key`);
  }
});
