import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  RETIRED_AGENTS,
  RETIRED_EXTENSIONS_PATH,
  retiredConfigNotices,
} from "../../src/application/upgrade_retired_notices.ts";
import { AGENT_FOLDERS } from "../../src/domain/agent_folders.ts";
import { fakeReader } from "./upgrade_fakes.ts";

/**
 * What upgrade says about a project file that still relies on something a
 * release retired. Read-only: every case here hands in a reader and no writer.
 */

const notices = (files: Record<string, string>, tracked: string[] = []) =>
  retiredConfigNotices(fakeReader(files), "/p", new Set(tracked));

Deno.test("every retired agent names the successor that took its work", () => {
  assertEquals(Object.keys(RETIRED_AGENTS).sort(), [
    "devops-sre",
    "qa-tester",
    "review-coordinator",
    "test-reviewer",
    "ui-ux-designer",
    "workflow-manager",
  ]);
  assertStringIncludes(RETIRED_AGENTS["review-coordinator"], "phases/review.md");
  assertEquals(RETIRED_AGENTS["test-reviewer"], "code-reviewer");
  assertEquals(RETIRED_AGENTS["ui-ux-designer"], "/design");
});

Deno.test("an addendum dispatching a retired agent is named, with its successor and the seed rule", async () => {
  const addendum = ".specnaut/addenda/task/review.md";
  const out = await notices({ [addendum]: "Dispatch `review-coordinator` after the gates.\n" });
  assertEquals(out.length, 2, out.join("\n"));
  assertStringIncludes(out[0], addendum);
  assertStringIncludes(out[0], `review-coordinator → ${RETIRED_AGENTS["review-coordinator"]}`);
  assertStringIncludes(out[1], "memory seeds");
  assertStringIncludes(out[1], "--force");
  assertStringIncludes(out[1], "backs them up");
});

Deno.test("a project's own agent is named on either harness; each name once, in table order", async () => {
  const out = await notices({
    ".claude/agents/my-reviewer.md": "Ask test-reviewer, then test-reviewer again.\n",
    ".codex/agents/my-designer.toml": 'instructions = "hand off to ui-ux-designer"\n',
  });
  assertEquals(out.length, 3, out.join("\n"));
  assertStringIncludes(out[0], ".claude/agents/my-reviewer.md");
  assertStringIncludes(out[0], "test-reviewer → code-reviewer");
  assertEquals(out[0].split("test-reviewer →").length, 2, "a name is listed once");
  assertStringIncludes(out[1], ".codex/agents/my-designer.toml");
  assertStringIncludes(out[1], "ui-ux-designer → /design");
});

Deno.test("every harness's agent folder is read, as AGENT_FOLDERS spells it", async () => {
  // The folders are the adapters' own (cli#712): a project's agent in any of
  // them still dispatches, whichever harness wrote it.
  const own = Object.values(AGENT_FOLDERS).flatMap((f) =>
    f === null ? [] : [`${f.dir}/mine${f.ext}`]
  );
  assert(own.length >= 2, "AGENT_FOLDERS declares no folder");
  const out = await notices(Object.fromEntries(own.map((p) => [p, "Ask test-reviewer.\n"])));
  assertEquals(out.slice(0, -1).map((l) => l.split(" ")[0]), own);
});

Deno.test("silent when no file the user owns names a retired agent", async () => {
  assertEquals(await notices({}), []);
  // An addendum about something else, and a name inside a longer one.
  assertEquals(
    await notices({
      ".specnaut/addenda/task/plan.md": "Run the architect first.\n",
      ".claude/agents/mine.md": "See my-qa-tester-notes, devops-sre2 and the old-test-reviewer.\n",
    }),
    [],
  );
  // Specnaut's own files are not the user's: an agent in the lock, a memory
  // seed (or its --force backup) under an agent's folder, a skill.
  assertEquals(
    await notices(
      {
        ".claude/agents/review-coordinator.md": "review-coordinator\n",
        ".claude/agents/qa-tester/memory/MEMORY.md.specnaut.bak": "qa-tester\n",
        ".claude/agents/developer/memory/MEMORY.md": "- qa-tester used to run smoke\n",
        ".claude/skills/mine/SKILL.md": "workflow-manager\n",
      },
      [".claude/agents/review-coordinator.md"],
    ),
    [],
  );
});

Deno.test("the extensions.yml notice still fires on its own", async () => {
  const out = await notices({ [RETIRED_EXTENSIONS_PATH]: "hooks: {}\n" });
  assertEquals(out.length, 1);
  assert(out[0].startsWith(`${RETIRED_EXTENSIONS_PATH} is no longer read`));
});
