import { assert, assertEquals, assertMatch } from "@std/assert";
import { join } from "@std/path";
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
  "/specnaut merge",
  "/specnaut merge --no-close",
  "$specnaut merge",
];
const RELEASE = [
  "release it",
  "tag it",
  "/ship release",
  "/ship tag v2",
  "$ship release",
  "yes, release it",
];
const NOTHING = [
  "yes",
  "ok",
  "go",
  "y",
  "sure, go ahead",
  "please merge it when ready",
  "don't merge",
  "merge it and then delete the branch",
  "/specnaut merged",
  "/specnaut review then merge",
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
