import { assert, assertEquals, assertMatch } from "@std/assert";
import { join } from "@std/path";
import { harnessCommands } from "../../../src/infrastructure/harness/harness_commands.ts";
import {
  approve,
  bashPath,
  HARNESSES,
  makeRepo,
  payload,
  runHook,
  sandbox,
  stamps,
} from "./hook_sandbox.ts";

/**
 * FR-007 — an approval exists only when the user's own top-level prompt
 * minted it, matched whole and anchored. The stamp lives outside the
 * workspace (§ 11 F3), carries `{session_id, turn_id, kind}`, and never
 * outlives its turn: `Stop` deletes it, and the next prompt replaces it.
 */

const MERGE = [
  "merge",
  "Merge",
  "  merge it  ",
  "land it",
  "push it.",
  "yes, merge",
  "/task merge",
  "/task merge --no-close",
  "/specnaut-task merge",
  "$specnaut-task merge",
];
const RELEASE = [
  "release it",
  "tag it",
  "/ship release",
  "/ship tag v2",
  "/specnaut-ship release",
  "$specnaut-ship release",
  "$specnaut-ship tag",
  "yes, release it",
];
// Spec 038 S2: each of the two project-owned kinds has its own phrase, and
// asking for an amendment is never approving one.
const CONSTITUTION = [
  "approve the constitution amendment",
  "  Approve the Constitution Amendment. ",
  "yes, approve the constitution amendment",
];
const GATE_CONFIG = ["approve the gate config change", "Approve the gate config change!"];
const NOTHING = [
  "amend the constitution",
  "/task constitution",
  "approve the constitution",
  "approve the constitution amendment and merge",
  "approve the gate config",
  "approve",
  "yes",
  "ok",
  "go",
  "y",
  "sure, go ahead",
  "please merge it when ready",
  "don't merge",
  "merge it and then delete the branch",
  "/task merged",
  "/task review then merge",
  "/task merge-x",
  "/task mergex",
  "please /task merge",
  "/tasks merge",
  // cli#683 retired these: they name a verb that no longer runs.
  "/specnaut merge",
  "$specnaut merge",
  "$ship release",
  "mergeit",
  "release",
  "ship it",
  "",
];

Deno.test("approve-on-prompt mints the right kind for each anchored phrase, on both harnesses", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb);
    for (const harness of HARNESSES) {
      const cases: Array<[string, string | null]> = [
        ...MERGE.map((p): [string, string] => [p, "merge"]),
        ...RELEASE.map((p): [string, string] => [p, "release"]),
        ...CONSTITUTION.map((p): [string, string] => [p, "constitution"]),
        ...GATE_CONFIG.map((p): [string, string] => [p, "gate-config"]),
        ...NOTHING.map((p): [string, null] => [p, null]),
      ];
      for (const [prompt, kind] of cases) {
        const r = await approve(sb, harness, repo, prompt);
        assertEquals(r.code, 0, `${harness} ${JSON.stringify(prompt)}: ${r.stderr}`);
        assertEquals(
          r.stdout,
          "",
          "UserPromptSubmit stdout is added to the model's context; keep it empty",
        );
        const files = await stamps(sb);
        if (kind === null) {
          assertEquals(files, [], `${harness}: ${JSON.stringify(prompt)} must mint nothing`);
          continue;
        }
        assertEquals(files.length, 1, `${harness}: ${JSON.stringify(prompt)} must mint one stamp`);
        const stamp = JSON.parse(await Deno.readTextFile(files[0]));
        const p = await payload(harness, "user_prompt_submit");
        assertEquals(stamp, {
          session_id: p.session_id,
          turn_id: (p.turn_id as string | undefined) ?? "",
          kind,
        }, `${harness}: ${JSON.stringify(prompt)}`);
      }
    }
  } finally {
    await sb.cleanup();
  }
});

Deno.test("the stamp lives under XDG_STATE_HOME, keyed by a hash of the toplevel, never in the repo", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb);
    await Deno.mkdir(join(repo, "src"));
    // Prompted from a subdirectory: the key is still the toplevel.
    await approve(sb, "codex", repo, "merge", { cwd: join(repo, "src") });
    const files = await stamps(sb);
    assertEquals(files.length, 1);
    // Compared in `/` form: on Windows both sides are `C:\…` paths.
    const store = `${bashPath(sb.state)}/specnaut/approvals/`;
    assert(bashPath(files[0]).startsWith(store), files[0]);
    assertMatch(bashPath(files[0]).slice(store.length), /^[0-9a-f]{64}\/[A-Za-z0-9_-]+$/);
    assert(!files[0].startsWith(repo));
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a subagent's prompt mints nothing and leaves the user's approval alone", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb);
    await approve(sb, "codex", repo, "merge");
    const sub = await payload("codex", "user_prompt_submit_subagent", {
      cwd: repo,
      prompt: "release it",
    });
    const r = await runHook(sb, "approve-on-prompt.sh", "codex", sub);
    assertEquals(r.code, 0);
    const files = await stamps(sb);
    assertEquals(files.length, 1);
    assertEquals(JSON.parse(await Deno.readTextFile(files[0])).kind, "merge");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("Stop deletes the stamp, and the next prompt replaces it", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb);
    for (const harness of HARNESSES) {
      await approve(sb, harness, repo, "merge");
      assertEquals((await stamps(sb)).length, 1);
      const stop = await runHook(
        sb,
        "approve-on-prompt.sh",
        harness,
        await payload(harness, "stop", { cwd: repo }),
      );
      assertEquals([stop.code, stop.stdout], [0, ""], stop.stderr);
      assertEquals(await stamps(sb), [], `${harness}: Stop must delete the stamp`);

      await approve(sb, harness, repo, "merge");
      await approve(sb, harness, repo, "thanks, looks good");
      assertEquals(
        await stamps(sb),
        [],
        `${harness}: an unrelated next prompt must delete the stamp`,
      );
    }
  } finally {
    await sb.cleanup();
  }
});

Deno.test("no stamp for a session id that is not a plain token, or a Codex prompt without turn_id", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb);
    for (const session of ["../../etc", "", "a b"]) {
      const r = await approve(sb, "codex", repo, "merge", { session_id: session });
      assertEquals(r.code, 0, "the writer never blocks the user's prompt");
      assertEquals(await stamps(sb), [], `session ${JSON.stringify(session)}`);
    }
    const r = await approve(sb, "codex", repo, "merge", { turn_id: "" });
    assertEquals(r.code, 0);
    assertEquals(await stamps(sb), []);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("the merge and release commands each harness prints mint an approval (cli#683)", async () => {
  // The hook's spellings are literals; what a user is told to type comes from
  // harnessCommands. This holds the two together, so a renamed skill cannot
  // leave `merge: manual` refusing the very command init printed.
  for (const harness of HARNESSES) {
    const sb = await sandbox();
    try {
      const repo = await makeRepo(sb);
      const cmd = harnessCommands(harness);
      assert(cmd.invocable, `${harness} invokes skills by name`);
      for (
        const [prompt, kind] of [
          [cmd.skillDoc("task", "merge"), "merge"],
          [cmd.skillDoc("ship", "release"), "release"],
          [cmd.skillDoc("ship", "tag"), "release"],
        ] as const
      ) {
        const r = await approve(sb, harness, repo, prompt);
        assertEquals(r.code, 0, `${harness} ${prompt}: ${r.stderr}`);
        const files = await stamps(sb);
        assertEquals(files.length, 1, `${harness}: ${prompt} must mint one stamp`);
        assertEquals(
          JSON.parse(await Deno.readTextFile(files[0])).kind,
          kind,
          `${harness}: ${prompt}`,
        );
      }
    } finally {
      await sb.cleanup();
    }
  }
});

Deno.test("a /task or /ship the lock does not list as Specnaut's mints nothing (cli#702)", async () => {
  // `/task` is a common name: a project with its own skill of that name, run
  // under bypass or auto permissions, must not have its `/task merge` land code.
  // A sandbox per harness: each harness's session keys its own stamp.
  for (const harness of HARNESSES) {
    const sb = await sandbox();
    try {
      const repo = await makeRepo(sb, { skills: [] });
      for (
        const prompt of ["/task merge", "/task merge --no-close", "/ship release", "/ship tag v2"]
      ) {
        const r = await approve(sb, harness, repo, prompt);
        assertEquals(r.code, 0, r.stderr);
        assertEquals(
          await stamps(sb),
          [],
          `${harness}: ${prompt} minted for a skill not Specnaut's`,
        );
      }
      // What only Specnaut spells, and the plain words, still mint.
      for (const prompt of ["merge", "/specnaut-task merge", "release it"]) {
        await approve(sb, harness, repo, prompt);
        assertEquals((await stamps(sb)).length, 1, `${harness}: ${prompt} must still mint`);
      }
    } finally {
      await sb.cleanup();
    }
  }
});
