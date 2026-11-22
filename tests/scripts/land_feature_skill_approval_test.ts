import { assertEquals, assertStringIncludes } from "@std/assert";
import { sha256Hex } from "../../src/domain/sha256.ts";
import { SHIPPED_REASON } from "../../src/domain/shipped_skills.ts";
import { APPROVALS_FILE } from "../../src/domain/skill_approvals.ts";
import { git, sandbox } from "./git_sandbox.ts";
import {
  customisedBase,
  landWithVerifier,
  landWithYes,
  MINE,
  SKILL,
  SUBJECT,
} from "./skill_approval_fixture.ts";

/**
 * A yes to a customised copy of a shipped skill is asked once per content: land-feature.sh, after a
 * yes that holds, commits the approval on top of the judged commit and lands both, so the next
 * branch lands without asking while the skill keeps those bytes.
 */

const NAMED = `VERDICT instructions untrusted ${SKILL} ${SHIPPED_REASON}`;

/** A binary from before `record-approvals`: an unknown command, exit 2, and a help without it. */
const OLDER = `case $1 in
  record-approvals) echo 'Unknown command: "record-approvals"' >&2; exit 2 ;;
  --help) "$REAL" --help | grep -v 'specnaut record-approvals'; exit 0 ;;
esac`;

Deno.test("a customised skill the base holds is asked about before it lands", async () => {
  const sb = await customisedBase();
  try {
    const refused = await sb.script("land-feature.sh");
    assertEquals(refused.code, 13, refused.stderr);
    assertStringIncludes(refused.stderr, NAMED);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a yes lands the approval in a commit of its own on the judged one", async () => {
  const sb = await customisedBase();
  try {
    const judged = await git(sb.work, "rev-parse", "HEAD");
    const r = await landWithYes(sb);
    assertEquals(r.code, 0, r.stderr);
    const landed = await git(sb.remote, "log", "-1", "--format=%s %P", "main");
    assertEquals(landed, `${SUBJECT} ${judged}`);
    const approvals = await git(sb.remote, "show", `main:${APPROVALS_FILE}`);
    assertEquals(approvals, `${await sha256Hex(MINE)}  ${SKILL}`);
    assertEquals(await git(sb.remote, "diff", "--name-only", judged, "main"), APPROVALS_FILE);
    const [here, there] = [
      await git(sb.work, "rev-parse", "HEAD"),
      await git(sb.remote, "rev-parse", "main"),
    ];
    assertEquals(here, there);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a skill whose approval landed is asked no more while it keeps its bytes", async () => {
  const sb = await customisedBase();
  try {
    assertEquals((await landWithYes(sb)).code, 0);
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
    assertEquals((await landWithYes(sb)).code, 0);
    await sb.commit(SKILL, `${MINE}.`, "docs: one more byte");
    await git(sb.work, "push", "--quiet", "origin", "main");
    await git(sb.work, "switch", "--quiet", "-c", "next");
    await sb.commit("notes.md", "y\n", "docs: more notes");
    const r = await sb.script("land-feature.sh");
    assertEquals(r.code, 13, r.stderr);
    assertStringIncludes(r.stderr, NAMED);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a verifier that cannot record approvals lands, and says nothing was recorded", {
  ignore: Deno.build.os === "windows",
}, async () => {
  const sb = await customisedBase();
  try {
    const judged = await git(sb.work, "rev-parse", "HEAD");
    const r = await landWithVerifier(sb, OLDER);
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
