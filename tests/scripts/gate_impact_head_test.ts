// `gate-impact.sh … --head <sha> [--objects <dir>]` and `_gate_evidence.sh`'s folder: the
// candidate is a commit read from git's objects by its id, and its evidence goes to the folder
// the caller names. The head lives only in a separate objects folder, and the project's work tree
// is left dirty, so a candidate taken from HEAD or the disk would be refused or misnamed.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { basename, dirname, join } from "@std/path";
import {
  assertNoGraphs,
  exportHead,
  gitRecorder,
  gitRecorderUnsure,
} from "./explicit_head_fixture.ts";
import { ifAbsent, impactRepo, type Repo } from "./gate_impact_fixture.ts";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";
import { spawn } from "./run_gate_fixture.ts";

const BASH = ".specnaut/scripts/bash";

/** The records gate-impact.sh wrote, one tab-split row per line. */
async function impact(
  repo: Repo,
  extra: string[],
  env: Record<string, string> = {},
): Promise<string[][]> {
  const commands = join(repo.outside, "commands");
  const records = join(repo.outside, "records");
  await Deno.writeTextFile(commands, "bash tools/mark.sh suite\n");
  const args = ["fast", bashPath(commands), bashPath(records), "--base", repo.main, ...extra];
  const r = await spawn(["bash", `${BASH}/gate-impact.sh`, ...args], repo.root, { env });
  assertEquals(r.code, 0, r.stderr);
  const text = await Deno.readTextFile(records);
  return text.replaceAll("\r", "").split("\n").filter(Boolean).map((l) => l.split("\t"));
}

const kinds = (rows: string[][], kind: string) => rows.filter((r) => r[0] === kind);

/** A project on `feature`, a head exported beside it, and the work tree left dirty. */
async function withHead(opts: Parameters<typeof impactRepo>[0] = {}) {
  const repo = await impactRepo(opts);
  const exported = await exportHead(repo.root, { "apps/web/a.ts": "the head's web\n" });
  await Deno.writeTextFile(join(repo.root, "apps/api/a.ts"), "an uncommitted edit\n");
  const tree = await repo.git(
    `--git-dir=${join(exported.side, "export.git")}`,
    "rev-parse",
    `${exported.head}^{tree}`,
  );
  return { repo, ...exported, tree };
}

Deno.test("gate impact --head: the candidate is the head, whatever the work tree holds", async () => {
  const { repo, head, objects, tree } = await withHead();
  const rows = await impact(repo, ["--head", head, "--objects", objects]);
  assertEquals(kinds(rows, "refused"), []);
  assertEquals(kinds(rows, "candidate"), [["candidate", tree, head]]);
  assertEquals(kinds(rows, "scope"), [["scope", "full", "-"]]);
  assertEquals(kinds(rows, "fallback"), [[
    "fallback",
    "head-not-checked-out: the adapter describes a work tree",
  ]]);
  assertEquals(rows.at(-1), ["end"]);
});

Deno.test({
  name: "gate impact --head: reads the objects folder with its graphs off",
  ignore: gitRecorderUnsure,
  fn: async () => {
    const { repo, head, objects, tree } = await withHead();
    const rec = await gitRecorder();
    const rows = await impact(repo, ["--head", head, "--objects", objects], rec.env);
    assertEquals(kinds(rows, "candidate"), [["candidate", tree, head]]);
    assertNoGraphs(await rec.calls(), "gate-impact");
  },
});

Deno.test("gate impact: without --head the same dirty tree is refused, as before", async () => {
  const { repo } = await withHead();
  const rows = await impact(repo, []);
  assertStringIncludes(kinds(rows, "refused")[0]?.[1] ?? "", "dirty-tree");
});

Deno.test("gate impact --head: a declaration only the work tree holds does not activate it", async () => {
  const { repo, head, objects } = await withHead({ declaration: null });
  await Deno.writeTextFile(join(repo.root, ".specnaut/impact.json"), '{"schema":1}\n');
  assertEquals(await impact(repo, ["--head", head, "--objects", objects]), [["inactive"], ["end"]]);
});

Deno.test("gate impact --head: a head out of reach is refused, never looked for", async () => {
  const { repo, head } = await withHead();
  const rows = await impact(repo, ["--head", head]);
  assertEquals(kinds(rows, "refused"), [[
    "refused",
    `head-refused: no commit ${head} in reach`,
  ]]);
});

Deno.test("gate impact --head: an empty --head or --objects, or another argument, is refused", async () => {
  const { repo, head } = await withHead();
  const cases: [string[], string][] = [
    [["--head", ""], "--head takes a value"],
    [["--head", head, "--objects", ""], "--objects takes a value"],
    [["--head", head, "--since", head], "usage: [--head <sha> [--objects <dir>]], not --since"],
  ];
  for (const [extra, why] of cases) {
    const rows = await impact(repo, extra);
    assertEquals(kinds(rows, "refused"), [["refused", `head-refused: ${why}`]], extra.join(" "));
  }
});

/**
 * `_gate_evidence.sh`'s `gate_evidence_write`, sourced and called with a folder after
 * `gate_candidate_head` took `head`. No script passes it a folder yet, so this is its caller.
 */
async function evidence(repo: Repo, head: string, objects: string, folder: string) {
  const records = join(repo.outside, "ev-records");
  const ran = join(repo.outside, "ev-ran");
  await Deno.writeTextFile(records, `candidate\tt\t${head}\nend\n`);
  await Deno.writeTextFile(ran, "");
  const script = [
    'REPO_ROOT="$1"; d="$1/.specnaut/scripts/bash"',
    '. "$d/_gate_candidate.sh" && . "$d/common.sh" && . "$d/_gate_evidence.sh" || exit 70',
    'gate_candidate_head --head "$2" --objects "$3" || { echo "head: $EXPLICIT_REFUSAL"; exit 9; }',
    'gate_evidence_write fast tree1 "$4" "$5" passed true "$6"',
  ].join("\n");
  const r = await spawn([
    "bash",
    "-c",
    script,
    "_",
    bashPath(repo.root),
    head,
    objects,
    bashPath(records),
    bashPath(ran),
    folder,
  ], repo.root);
  assertEquals(r.code, 0, r.stdout + r.stderr);
  return r.stdout.trim();
}

const inGitDir = async (repo: Repo) =>
  join(repo.root, await repo.git("rev-parse", "--git-path", "specnaut/gate-evidence"));

Deno.test("gate evidence --head: written to the folder given, never inside the repository", async () => {
  const { repo, head, objects } = await withHead();
  const folder = bashPath(await Deno.makeTempDir({ prefix: "gate-review-" }));
  const where = await evidence(repo, head, objects, folder);
  assertEquals(where, `${folder}/specnaut/gate-evidence/fast-tree1.json`);
  const written = JSON.parse(await Deno.readTextFile(where));
  assertEquals(written.commit, head);
  const inside = await Deno.stat(await inGitDir(repo)).then(() => true, ifAbsent(false));
  assert(!inside, "evidence reached the repository's git directory");
});

Deno.test("gate evidence --head: no folder, a relative or absent one, or one beside the head", async () => {
  const { repo, head, objects, side } = await withHead();
  await Deno.mkdir(join(side, "review"));
  // Another spelling of the same folder, where the file system folds case; elsewhere, none.
  const cased = join(dirname(side), basename(side).toUpperCase(), "review");
  const folds = await Deno.stat(cased).then(() => true, ifAbsent(false));
  const cases: [string, string][] = [
    [
      bashPath(cased),
      folds ? "unwritten (evidence-beside-the-head)" : "unwritten (evidence-folder-missing)",
    ],
    ["", "unwritten (no-evidence-folder)"],
    ["review/evidence", "unwritten (evidence-folder-relative)"],
    [bashPath(join(repo.outside, "absent")), "unwritten (evidence-folder-missing)"],
    [bashPath(join(side, "review")), "unwritten (evidence-beside-the-head)"],
  ];
  for (const [folder, why] of cases) {
    assertEquals(await evidence(repo, head, objects, folder), why, folder);
  }
  const inside = await Deno.stat(await inGitDir(repo)).then(() => true, ifAbsent(false));
  assert(!inside, "evidence reached the repository's git directory");
  assertEquals([...Deno.readDirSync(join(side, "review"))], [], "evidence landed beside the head");
});
