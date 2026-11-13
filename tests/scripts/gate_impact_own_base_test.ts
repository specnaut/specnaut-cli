// `gate-impact.sh … --head <sha> --objects <dir>`: a base is where the branch will land, so it is
// resolved from the project's own objects only. A commit that only the objects folder holds - the
// head itself here - is no base, whether `--base` names it or a pushed ref's remote side does.

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { exportHead } from "./explicit_head_fixture.ts";
import { impactRepo, type Repo } from "./gate_impact_fixture.ts";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";
import { spawn } from "./run_gate_fixture.ts";

const BASH = ".specnaut/scripts/bash";

/** The records gate-impact.sh wrote for `mode` (`--base <rev>` or `--refs-stdin`), tab-split. */
async function impact(repo: Repo, mode: [string, string], extra: string[], stdin = "") {
  const commands = join(repo.outside, "commands");
  const records = join(repo.outside, "records");
  await Deno.writeTextFile(commands, "bash tools/mark.sh suite\n");
  const args = ["fast", bashPath(commands), bashPath(records), ...mode, ...extra];
  const r = await spawn(["bash", `${BASH}/gate-impact.sh`, ...args], repo.root, { stdin });
  assertEquals(r.code, 0, r.stderr);
  const text = await Deno.readTextFile(records);
  return text.replaceAll("\r", "").split("\n").filter(Boolean).map((l) => l.split("\t"));
}

const kinds = (rows: string[][], ...wanted: string[]) => rows.filter((r) => wanted.includes(r[0]));

async function withHead() {
  const repo = await impactRepo();
  const { head, objects } = await exportHead(repo.root, { "apps/web/a.ts": "the head's web\n" });
  return { repo, head, objects, given: ["--head", head, "--objects", objects] };
}

Deno.test("gate impact --head: a --base only the objects folder holds is unresolved", async () => {
  const { repo, head, given } = await withHead();
  const control = await impact(repo, ["--base", repo.main], given);
  assertEquals(kinds(control, "base"), [["base", repo.main]], "the control: a project base");
  assertEquals(kinds(control, "candidate")[0]?.[2], head, "the control: the folder is read");

  const rows = await impact(repo, ["--base", head], given);
  assertEquals(kinds(rows, "base", "fallback"), [["fallback", `base-unresolved: ${head}`]]);
});

Deno.test("gate impact --head: a pushed ref's remote side only the objects folder holds is unfetched", async () => {
  const { repo, head, given } = await withHead();
  const line = (remote: string) => `refs/heads/feature ${head} refs/heads/feature ${remote}\n`;
  const control = await impact(repo, ["--refs-stdin", ""], given, line(repo.main));
  assertEquals(kinds(control, "base"), [["base", repo.main]], "the control: a project base");

  const rows = await impact(repo, ["--refs-stdin", ""], given, line(head));
  assertEquals(kinds(rows, "base", "fallback"), [["fallback", `remote-unfetched: ${head}`]]);
});
