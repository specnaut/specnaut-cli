import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { sha256Hex } from "../../src/domain/sha256.ts";
import { SHIPPED_REASON } from "../../src/domain/shipped_skills.ts";
import { APPROVALS_FILE } from "../../src/domain/skill_approvals.ts";
import { bundled } from "../integration/verify_scripts_fixture.ts";
import { git, run, type Sandbox, sandbox } from "./git_sandbox.ts";
import { withSpecnaut } from "./specnaut_shim.ts";

/**
 * A yes to a customised copy of a shipped skill is asked once per content: land-feature.sh, after a
 * yes that holds, commits the approval on top of the judged commit and lands both, so the next
 * branch lands without asking while the skill keeps those bytes.
 */

const SKILL = ".claude/skills/task/SKILL.md";
const MINE = `${bundled(SKILL)}\nAsk before every merge.\n`;
const SUBJECT = "chore(specnaut): approve customised skill content";

/** A base that already holds a customised shipped skill, and a feature branch with one commit. */
async function customisedBase(): Promise<Sandbox> {
  const sb = await sandbox();
  await sb.commit(SKILL, MINE, "docs: our own task skill");
  await git(sb.work, "push", "--quiet", "origin", "main");
  await git(sb.work, "switch", "--quiet", "-c", "feature");
  await sb.commit("notes.md", "x\n", "docs: notes");
  return sb;
}

/** The INSTRUCTIONS_DIGEST the verifier prints in the clone, its names file removed. */
async function digest(sb: Sandbox): Promise<string> {
  const out = (await run("bash", ["-c", "specnaut verify-scripts"], sb.work)).stdout;
  const field = (key: string) => out.match(new RegExp(`^${key} (.+)$`, "m"))?.[1] ?? "";
  await Deno.remove(field("NAMES_FILE"));
  return field("INSTRUCTIONS_DIGEST");
}

Deno.test("a customised skill the base holds is asked about, then asked no more", async () => {
  const sb = await customisedBase();
  try {
    const refused = await sb.script("land-feature.sh");
    assertEquals(refused.code, 13, refused.stderr);
    assertStringIncludes(
      refused.stderr,
      `VERDICT instructions untrusted ${SKILL} ${SHIPPED_REASON}`,
    );
    const judged = await git(sb.work, "rev-parse", "HEAD");
    const r = await sb.script("land-feature.sh", "--instructions-digest", await digest(sb));
    assertEquals(r.code, 0, r.stderr);
    assertEquals(
      await git(sb.remote, "log", "-1", "--format=%s %P", "main"),
      `${SUBJECT} ${judged}`,
    );
    const approvals = await git(sb.remote, "show", `main:${APPROVALS_FILE}`);
    assertEquals(approvals, `${await sha256Hex(MINE)}  ${SKILL}`);
    assertEquals(await git(sb.remote, "diff", "--name-only", `${judged}`, "main"), APPROVALS_FILE);
    assertEquals(
      await git(sb.work, "rev-parse", "HEAD"),
      await git(sb.remote, "rev-parse", "main"),
    );
    await git(sb.work, "switch", "--quiet", "-c", "next");
    await sb.commit("notes.md", "y\n", "docs: more notes");
    const next = await sb.script("land-feature.sh");
    assertEquals(next.code, 0, next.stderr);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a skill whose approved bytes changed on the base is asked about again", async () => {
  const sb = await customisedBase();
  try {
    assertEquals(
      (await sb.script("land-feature.sh", "--instructions-digest", await digest(sb))).code,
      0,
    );
    await sb.commit(SKILL, `${MINE}.`, "docs: one more byte");
    await git(sb.work, "push", "--quiet", "origin", "main");
    await git(sb.work, "switch", "--quiet", "-c", "next");
    await sb.commit("notes.md", "y\n", "docs: more notes");
    const r = await sb.script("land-feature.sh");
    assertEquals(r.code, 13, r.stderr);
    assertStringIncludes(r.stderr, `VERDICT instructions untrusted ${SKILL} ${SHIPPED_REASON}`);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a verifier that cannot record approvals lands, and says nothing was recorded", {
  // The older verifier is a bash script on the PATH; Windows resolves its tools otherwise.
  ignore: Deno.build.os === "windows",
}, async () => {
  const sb = await customisedBase();
  try {
    const old = join(sb.root, "old");
    await Deno.mkdir(old);
    const real = (await run("bash", ["-c", "command -v specnaut"], sb.work)).stdout.trim();
    await Deno.writeTextFile(
      join(old, "specnaut"),
      `#!/usr/bin/env bash\n[ "$1" = record-approvals ] && exit 2\nexec '${real}' "$@"\n`,
    );
    await Deno.chmod(join(old, "specnaut"), 0o755);
    const judged = await git(sb.work, "rev-parse", "HEAD");
    const r = await run(
      "bash",
      [".specnaut/scripts/bash/land-feature.sh", "--instructions-digest", await digest(sb)],
      sb.work,
      {
        PATH: `${old}:${withSpecnaut(Deno.env.get("PATH"))}`,
      },
    );
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stderr, "APPROVALS NOT RECORDED");
    assertEquals(await git(sb.remote, "rev-parse", "main"), judged);
    assertEquals(await git(sb.remote, "ls-tree", "main", "--", APPROVALS_FILE), "");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a digest passed for instructions already trusted records nothing, and lands", async () => {
  const sb = await sandbox();
  try {
    await git(sb.work, "switch", "--quiet", "-c", "feature");
    const judged = await sb.commit("notes.md", "x\n", "docs: notes");
    const r = await sb.script("land-feature.sh", "--instructions-digest", "0".repeat(64));
    assertEquals(r.code, 0, r.stderr);
    assertEquals(await git(sb.remote, "rev-parse", "main"), judged);
  } finally {
    await sb.cleanup();
  }
});
