import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { sha256Hex } from "../../src/domain/sha256.ts";
import { APPROVALS_FILE } from "../../src/domain/skill_approvals.ts";
import { runSpecnaut } from "../helpers/run_specnaut.ts";
import { bundled, commitAll, fixture, git, verify, write } from "./verify_scripts_fixture.ts";
import { base } from "./verify_instructions_fixture.ts";
import { DENO_DIR } from "./spawn_env.ts";

/**
 * `specnaut record-approvals` judges HEAD again at the commits it is given and, only when the yes's
 * digest still holds, writes the approvals of the customised shipped skills that yes covered to a
 * temporary file: never the work tree, never a commit. `land-feature.sh` commits that file.
 */

const TASK = ".claude/skills/task/SKILL.md";
const SHIP = ".claude/skills/ship/SKILL.md";
const MINE = `${bundled(TASK)}\nAsk before every merge.\n`;
const line = async (text: string, path: string) => `${await sha256Hex(text)}  ${path}\n`;

let home: string | undefined;

/** An empty HOME for the CLI, made once, as `verify` has: the developer's git config stays out. */
function cliHome(): Record<string, string> {
  home ??= Deno.makeTempDirSync({ prefix: "record-approvals-home-" });
  return { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config"), DENO_DIR };
}

type Recorded = { code: number; lines: string[]; file: string | null; stderr: string };

/** Judges `root`'s HEAD, then records under the digest `yes` (that run's own when absent). */
async function record(root: string, yes?: string): Promise<Recorded> {
  const v = await verify(root);
  await Deno.remove(v.field("NAMES_FILE")!);
  const head = (await git(root, "rev-parse", "HEAD")).trim();
  const digest = yes ?? v.field("INSTRUCTIONS_DIGEST")!;
  const args = [
    "--instructions-digest",
    digest,
    "--head",
    head,
    "--base-tip",
    v.field("BASE_TIP")!,
  ];
  const r = await runSpecnaut(["record-approvals", ...args], { cwd: root, env: cliHome() });
  const lines = r.stdout.trimEnd().split("\n");
  const path = lines.find((l) => l.startsWith("APPROVALS_FILE "))?.slice(15);
  const file = path === undefined ? null : await Deno.readTextFile(path);
  if (path !== undefined) await Deno.remove(path);
  return { code: r.code, lines, file, stderr: r.stderr };
}

/** The work tree and HEAD are as the branch left them: the command writes neither. */
async function untouched(root: string) {
  assertEquals((await git(root, "status", "--porcelain")).trim(), "");
  assertEquals(await Deno.stat(join(root, APPROVALS_FILE)).catch(() => null), null);
}

Deno.test("a yes that holds writes the approval of the customised skill it covered", async () => {
  const { root } = await fixture({ files: { ...base(), [TASK]: MINE } });
  // The branch's own edit to a shipped skill: shown as its diff from the base, never recorded.
  await write(root, { "README.md": "x\n", [SHIP]: `${bundled(SHIP)}\nBranch edit.\n` });
  await commitAll(root, "docs: readme");
  const r = await record(root);
  assertEquals(r.code, 0, r.stderr);
  assertEquals(r.lines.slice(0, -1), [`APPROVED ${await sha256Hex(MINE)} ${TASK}`]);
  assertEquals(r.file, await line(MINE, TASK));
  await untouched(root);
});

Deno.test("a digest that moved writes nothing: exit 1", async () => {
  const { root } = await fixture({ files: { ...base(), [TASK]: MINE } });
  const r = await record(root, "0".repeat(64));
  assertEquals([r.code, r.file], [1, null], r.stderr);
  assertStringIncludes(r.lines.join("\n"), "APPROVAL instructions moved ");
  await untouched(root);
});

Deno.test("a write keeps the approvals still in force, adds the new, drops the dormant", async () => {
  const theirs = `${bundled(SHIP)}\nTheirs.\n`;
  const approvals = [await line(theirs, SHIP), await line(MINE, TASK)].join("");
  const files = { ...base(), [TASK]: MINE, [APPROVALS_FILE]: approvals };
  const { root } = await fixture({ files: { ...files, [SHIP]: bundled(SHIP) } });
  const skill = ".claude/skills/specnaut/SKILL.md";
  const custom = `${bundled(skill)}\nMine too.\n`;
  await git(root, "checkout", "-q", "main");
  await write(root, { [skill]: custom });
  await commitAll(root, "customise another skill");
  await git(root, "push", "-q", "origin", "main");
  await git(root, "checkout", "-q", "-B", "feature");
  const r = await record(root);
  assertEquals(r.code, 0, r.stderr);
  assertEquals(r.lines[0], `APPROVED ${await sha256Hex(custom)} ${skill}`);
  assertEquals(r.file, await line(custom, skill) + await line(MINE, TASK));
});

Deno.test("nothing to record and nothing dormant leaves the file as it is", async () => {
  const files = { ...base(), [TASK]: MINE, [APPROVALS_FILE]: await line(MINE, TASK) };
  const { root } = await fixture({ files });
  const r = await record(root);
  assertEquals([r.code, r.lines, r.file], [0, ["APPROVALS unchanged"], null], r.stderr);
});
