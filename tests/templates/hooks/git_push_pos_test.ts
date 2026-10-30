import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { HOOKS_DIR, makeRepo, payload, runHook, sandbox } from "./hook_sandbox.ts";
import { bash as merge, verdict } from "./guard_merge_fixture.ts";

/**
 * cli#700 — which `git push` options take the next word as their value is
 * read in one place, _git.sh's git_push_pos, by both guards that read a push.
 * Two copies of that list could disagree on whether a word is a refspec: one
 * guard would judge `main` in `git push origin -o main feat` as a destination,
 * the other as the push option's value.
 */

const VALUE_OPTIONS = "-o | --push-option | --repo | --receive-pack | --exec)";

Deno.test("git_push_pos: the value-taking push options are spelled in _git.sh alone", async () => {
  const spelled: string[] = [];
  for await (const e of Deno.readDir(HOOKS_DIR)) {
    if (!e.isFile || !e.name.endsWith(".sh")) continue;
    const text = await Deno.readTextFile(join(HOOKS_DIR, e.name));
    if (text.includes(VALUE_OPTIONS)) spelled.push(e.name);
  }
  assertEquals(spelled, ["_git.sh"]);
});

Deno.test("git_push_pos: an option's value is no refspec, for either guard", async () => {
  const sb = await sandbox();
  try {
    const manual = await makeRepo(sb, { head: "feat" });
    const auto = await makeRepo(sb, { mode: "auto", head: "feat" });
    // `main` is -o's value: the push lands on feat
    assertEquals(
      verdict(await merge(sb, "codex", manual, "git push origin -o main feat")),
      "allow",
    );
    assertEquals(verdict(await merge(sb, "codex", manual, "git push origin -o x main")), "deny");
    // `v9.9.9` is --push-option's value: no tag is pushed
    const release = async (command: string) =>
      runHook(
        sb,
        "guard-release.sh",
        "codex",
        await payload("codex", "pre_tool_use_bash", { cwd: auto, tool_input: { command } }),
      );
    const value = await release("git push origin --push-option v9.9.9 feat");
    assertEquals([value.code, value.stderr], [0, ""]);
    const tag = await release("git push origin --push-option x v9.9.9");
    assertEquals(tag.code, 2, tag.stderr);
    assertEquals(tag.stderr.includes("a push of a tag publishes a release"), true, tag.stderr);
  } finally {
    await sb.cleanup();
  }
});
