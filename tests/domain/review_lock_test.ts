import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  lockedCallOf,
  lockedCallRefusal,
  type LockedReview,
  REVIEW_SEATS,
} from "../../src/domain/review_lock.ts";

const SHA = "a".repeat(40);
const REVIEW: LockedReview = { head: SHA, logs: "/c/logs" };
const LOG = "/c/logs/1.log";
const bash = (command: string, review = REVIEW, log: string | null = LOG) =>
  lockedCallRefusal("Bash", { command }, review, log);
const tool = (name: string | null, input: unknown) => lockedCallRefusal(name, input, REVIEW, null);

Deno.test("under the review lock, Read, Grep and Glob run, and the review seats are dispatched", () => {
  for (const name of ["Read", "Grep", "Glob"]) {
    assertEquals(tool(name, { file_path: "/x" }), null, name);
  }
  for (const seat of REVIEW_SEATS) {
    for (const name of ["Agent", "Task"]) {
      assertEquals(tool(name, { subagent_type: seat, prompt: "p" }), null, seat);
    }
  }
});

Deno.test("under the review lock, every other tool is refused: MCP tools, WebFetch, edits", () => {
  const tools = [
    "mcp__github__create_issue",
    "mcp__tracker__move_card",
    "WebFetch",
    "WebSearch",
    "Edit",
    "Write",
    "MultiEdit",
    "NotebookEdit",
    "Skill",
    "read",
    "",
    null,
  ];
  for (const name of tools) {
    const why = tool(name, { url: "https://x" });
    assertStringIncludes(why ?? "allowed", "review lock", String(name));
  }
});

Deno.test("under the review lock, a dispatch names a review seat or is refused", () => {
  const inputs = [
    { subagent_type: "developer" },
    { subagent_type: "product-owner" },
    { subagent_type: "general-purpose" },
    { prompt: "no seat named" },
    { subagent_type: ["code-reviewer"] },
    null,
    "code-reviewer",
  ];
  for (const input of inputs) {
    assertStringIncludes(tool("Agent", input) ?? "allowed", "seat", String(input));
  }
});

Deno.test("under the review lock, review end removes the session's own head, and no other", () => {
  assertEquals(bash(`specnaut review end ${SHA}`), null);
  const other = `specnaut review end ${"b".repeat(40)}`;
  assertStringIncludes(bash(other) ?? "allowed", "review lock", "another head");
  const unknown = { head: null, logs: null };
  assertStringIncludes(bash(`specnaut review end ${SHA}`, unknown) ?? "allowed", "review lock");
});

Deno.test("under the review lock, a dispatch carries a seat, a description and a prompt, nothing else", () => {
  const seat = { subagent_type: "code-reviewer", description: "d", prompt: "p" };
  assertEquals(tool("Agent", seat), null);
  assertEquals(tool("Agent", { subagent_type: "code-reviewer" }), null);
  for (const key of ["isolation", "run_in_background", "model", "cwd", "__proto__x"]) {
    const why = tool("Agent", { ...seat, [key]: "x" });
    assertStringIncludes(why ?? "allowed", "review lock", key);
    assertStringIncludes(why ?? "", key, key);
  }
});

Deno.test("under the review lock, the review's own commands run, each alone", () => {
  const allowed = [
    "specnaut verify-scripts",
    "specnaut sandbox probe",
    `specnaut sandbox exec ${SHA} --log ${LOG} -- deno task test`,
    `specnaut sandbox exec ${SHA} --log ${LOG} -- sh -c 'a && b'`,
    `specnaut review end ${SHA}`,
    `bash .specnaut/scripts/audit/collect-audit-scope.sh --base ${SHA} --head ${SHA} --objects /c/o`,
    `bash .specnaut/scripts/bash/size-ratchet.sh --since ${SHA} --head ${SHA} --objects /c --report`,
    `bash .specnaut/scripts/bash/boundary-check.sh --head ${SHA} --objects /c/o`,
    `bash .specnaut/scripts/bash/git-read.sh --head ${SHA} --objects /c/o patch ${SHA} ${SHA} a.ts`,
    `bash .specnaut/scripts/bash/run-gate.sh fast --base ${SHA} --head ${SHA} --objects /c/o ` +
    `--evidence /tmp/l --sandbox`,
  ];
  for (const command of allowed) assertEquals(bash(command), null, command);
});

Deno.test("under the review lock, a push, a tracker write, a merge or the landing script is refused", () => {
  const refused = [
    "git push origin main",
    "git push --force",
    "gh issue close 12",
    "gh issue edit 12 --add-label x",
    "gh pr merge 12",
    "gh api -X PATCH repos/o/r/issues/12",
    "gh project item-edit --id x",
    "glab mr merge 12",
    "bash .specnaut/scripts/bash/land-feature.sh",
    "bash .specnaut/scripts/backlog/move.sh 12 Done",
    "bash scripts/land.sh cli topic",
    "git merge --ff-only topic",
    "specnaut review start 12",
    "specnaut review end HEAD",
    "specnaut task close 12",
    "specnaut verify-scripts --remote",
    "specnaut sandbox probe x",
    "mktemp -d",
    "mktemp -d -p .git",
    "mktemp",
    "rm -rf .git/specnaut",
    "curl https://x",
    "cd /",
    "bash .specnaut/scripts/bash/run-gate.sh full",
    `bash .specnaut/scripts/bash/run-gate.sh fast --head ${SHA} --objects /c/o --evidence /t`,
    "bash .specnaut/scripts/bash/git-read.sh patch a b",
    "bash .specnaut/scripts/bash/size-ratchet.sh --since main --report",
    "bash ./.specnaut/scripts/bash/boundary-check.sh --head x",
    "bash -c 'git push'",
    "sh .specnaut/scripts/bash/git-read.sh --head x",
    "echo verify-scripts",
    "npx sandbox exec x",
  ];
  for (const command of refused) {
    assertStringIncludes(bash(command) ?? "allowed", "review lock", command);
  }
});

Deno.test("under the review lock, a review command chained to another, or substituted, is refused", () => {
  const refused = [
    "specnaut verify-scripts; git push",
    "specnaut verify-scripts && git push",
    "specnaut verify-scripts | sh",
    "specnaut verify-scripts > .git/specnaut/review-lock/s.json",
    "specnaut review end $(git push)",
    "GIT_DIR=/x specnaut verify-scripts",
    "PATH=/tmp/x specnaut verify-scripts",
    "specnaut verify-scripts\ngit push",
    `specnaut sandbox exec ${SHA} -- x; git push`,
  ];
  for (const command of refused) {
    assertStringIncludes(bash(command) ?? "allowed", "review lock", command);
  }
  for (const input of [{}, { command: 1 }, null, { command: ["specnaut", "verify-scripts"] }]) {
    assertStringIncludes(tool("Bash", input) ?? "allowed", "review lock");
  }
});

Deno.test("a script name looked up as a property of the table does not pass for a script", () => {
  for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    assertStringIncludes(bash(`bash ${name} --head x --sandbox`) ?? "allowed", "review lock");
  }
});

Deno.test("a hook's input is read for its session id, its tool and the tool's input", () => {
  const input = { command: "ls" };
  assertEquals(
    lockedCallOf({ session_id: "s-1", tool_name: "Bash", tool_input: input }),
    { sessionId: "s-1", tool: "Bash", input },
  );
  for (const payload of [undefined, null, "x", [], { session_id: 7, tool_name: ["Read"] }]) {
    assertEquals(lockedCallOf(payload), { sessionId: null, tool: null, input: undefined });
  }
});
