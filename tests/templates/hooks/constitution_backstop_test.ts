import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import {
  approve,
  type Harness,
  HARNESSES,
  makeRepo,
  payload,
  runHook,
  type Sandbox,
  sandbox,
  stamps,
} from "./hook_sandbox.ts";

/**
 * Spec 038 § 11 S1, the writer-agnostic backstop: no reading of a command
 * sees every writer, so each user prompt fingerprints the four project-owned
 * files and Stop compares. A change no approval of its kind covered blocks the
 * stop with a question, and the version from the start of the turn is kept —
 * never restored, since the change may be the user's own.
 *
 * And S2's other half: the phrases that mint `constitution` and `gate-config`
 * are the ones `/task constitution` tells the user to type.
 */

const C = "docs/constitution.md";
const UI = ".specnaut/ui.yml";
const PHASE = fromFileUrl(
  new URL("../../../templates/core/skills/task/phases/constitution.md", import.meta.url),
);

async function project(sb: Sandbox): Promise<string> {
  const repo = await makeRepo(sb, { mode: "auto" });
  await Deno.mkdir(join(repo, "docs"));
  await Deno.writeTextFile(join(repo, C), "# Constitution\n\nVersion: 1.0.0\n");
  await Deno.writeTextFile(join(repo, UI), "target_surface: desktop\n");
  return repo;
}

async function stop(sb: Sandbox, h: Harness, repo: string, active = false) {
  const p = await payload(h, "stop", { cwd: repo, stop_hook_active: active });
  const r = await runHook(sb, "approve-on-prompt.sh", h, p);
  assertEquals(r.code, 0, `${h}: Stop never fails: ${r.stderr}`);
  return r;
}

/** The reason of a Stop `block`, or null when the stop goes through. */
function blocked(r: { stdout: string }): string | null {
  if (r.stdout === "") return null;
  const out = JSON.parse(r.stdout);
  assertEquals(out.decision, "block", r.stdout);
  return out.reason;
}

Deno.test("Stop blocks with a question when a guarded file changed unapproved, keeps a copy, restores nothing", async () => {
  for (const h of HARNESSES) {
    const sb = await sandbox();
    try {
      const repo = await project(sb);
      await approve(sb, h, repo, "please tidy the readme");
      await Deno.writeTextFile(join(repo, C), "# Constitution\n\nrewritten\n");
      const reason = blocked(await stop(sb, h, repo));
      assert(reason !== null, `${h}: an unapproved change must block the stop`);
      assertStringIncludes(reason, C);
      assertStringIncludes(reason, "ask the user one question");
      const kept = /kept at (\S+)\)/.exec(reason)?.[1];
      assert(kept !== undefined, reason);
      assertEquals(await Deno.readTextFile(kept), "# Constitution\n\nVersion: 1.0.0\n");
      assert(!kept.startsWith(repo), "the copy is kept outside the workspace");
      assertEquals(await Deno.readTextFile(join(repo, C)), "# Constitution\n\nrewritten\n");

      // Asked once: the stop the block continued goes through.
      assertEquals(blocked(await stop(sb, h, repo, true)), null);
      assertEquals(blocked(await stop(sb, h, repo)), null, `${h}: re-baselined after the block`);
    } finally {
      await sb.cleanup();
    }
  }
});

Deno.test("Stop lets through a change its own kind approved, and nothing else", async () => {
  for (const h of HARNESSES) {
    const sb = await sandbox();
    try {
      const repo = await project(sb);
      await approve(sb, h, repo, "approve the constitution amendment");
      await Deno.writeTextFile(join(repo, C), "# Constitution\n\nVersion: 1.1.0\n");
      assertEquals(blocked(await stop(sb, h, repo)), null, `${h}: the approved amendment`);
      assertEquals(await stamps(sb), [], "Stop still deletes the stamp");

      await approve(sb, h, repo, "approve the constitution amendment");
      await Deno.writeTextFile(join(repo, UI), "target_surface: anything\n");
      const wrongKind = blocked(await stop(sb, h, repo));
      assert(wrongKind?.includes(UI), `${h}: a config needs gate-config, not constitution`);

      await approve(sb, h, repo, "approve the gate config change");
      await Deno.writeTextFile(join(repo, UI), "target_surface: desktop\n");
      assertEquals(blocked(await stop(sb, h, repo)), null, `${h}: the approved config change`);
    } finally {
      await sb.cleanup();
    }
  }
});

Deno.test("Stop sees a created and a deleted file; an untouched turn stays silent", async () => {
  for (const h of HARNESSES) {
    const sb = await sandbox();
    try {
      const repo = await project(sb);
      await approve(sb, h, repo, "go on");
      assertEquals((await stop(sb, h, repo)).stdout, "", `${h}: nothing changed, nothing said`);

      await approve(sb, h, repo, "go on");
      await Deno.writeTextFile(join(repo, ".specnaut/size-limits.yml"), "file:\n");
      const created = blocked(await stop(sb, h, repo));
      assertStringIncludes(created ?? "", "did not exist when the turn began");

      // Absent is not empty: truncating a config into existence is a change.
      await approve(sb, h, repo, "go on");
      await Deno.writeTextFile(join(repo, ".specnaut/boundaries.yml"), "");
      assertStringIncludes(blocked(await stop(sb, h, repo)) ?? "", ".specnaut/boundaries.yml");

      await approve(sb, h, repo, "go on");
      await Deno.remove(join(repo, C));
      assertStringIncludes(blocked(await stop(sb, h, repo)) ?? "", C);
    } finally {
      await sb.cleanup();
    }
  }
});

Deno.test("a stop the hook already continued is never blocked again: it says so on stderr", async () => {
  for (const h of HARNESSES) {
    const sb = await sandbox();
    try {
      const repo = await project(sb);
      await approve(sb, h, repo, "go on");
      await Deno.writeTextFile(join(repo, C), "changed\n");
      const r = await stop(sb, h, repo, true);
      assertEquals(r.stdout, "", `${h}: stop_hook_active must not loop`);
      assertStringIncludes(r.stderr, C);
    } finally {
      await sb.cleanup();
    }
  }
});

Deno.test("a subagent's prompt does not re-fingerprint the turn", async () => {
  const sb = await sandbox();
  try {
    const repo = await project(sb);
    await approve(sb, "codex", repo, "go on");
    await Deno.writeTextFile(join(repo, C), "changed by the agent\n");
    const sub = await payload("codex", "user_prompt_submit_subagent", { cwd: repo });
    assertEquals((await runHook(sb, "approve-on-prompt.sh", "codex", sub)).code, 0);
    assert(blocked(await stop(sb, "codex", repo)) !== null, "the main turn's change is still seen");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("the phrases /task constitution prints are the ones that mint each kind (S2)", async () => {
  const phase = await Deno.readTextFile(PHASE);
  assertStringIncludes(phase, "docs/constitution.md");
  // The table row: | <what> | `<phrase>` | `<kind>` |
  const rows = [...phase.matchAll(/^\| [^|]+ \| `([^`]+)` \| `(constitution|gate-config)` \|$/gm)];
  assertEquals(rows.map((r) => r[2]).sort(), ["constitution", "gate-config"], phase);
  for (const h of HARNESSES) {
    const sb = await sandbox();
    try {
      const repo = await makeRepo(sb);
      for (const [, phrase, kind] of rows) {
        await approve(sb, h, repo, phrase);
        const files = await stamps(sb);
        assertEquals(files.length, 1, `${h}: ${phrase} must mint a stamp`);
        assertEquals(JSON.parse(await Deno.readTextFile(files[0])).kind, kind, `${h}: ${phrase}`);
      }
    } finally {
      await sb.cleanup();
    }
  }
});
