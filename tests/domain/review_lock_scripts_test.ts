import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  lockedCallRefusal,
  type LockedReview,
  UNKNOWN_REVIEW,
} from "../../src/domain/review_lock.ts";

/**
 * The review's scripts under the lock: their `--head` is the head the review exported and the gate
 * runner's `--evidence` the folder made for its logs, as `review start` printed them; the words
 * after the required flags are each script's own, which refuses any option it does not know.
 */

const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);
const REVIEW: LockedReview = { head: SHA, logs: "/c/logs" };
const bash = (command: string, review = REVIEW) =>
  lockedCallRefusal("Bash", { command }, review, null);
const GATE = "bash .specnaut/scripts/bash/run-gate.sh fast";
const READ = "bash .specnaut/scripts/bash/git-read.sh";

Deno.test("under the review lock, a script reads the review's head and logs in its folder", () => {
  assertEquals(bash(`${GATE} --head ${SHA} --objects /o --evidence /c/logs --sandbox`), null);
  assertEquals(bash(`${READ} --head ${SHA} --objects /o patch ${OTHER} ${SHA} a.ts`), null);
  const refused = [
    `${GATE} --head ${OTHER} --objects /o --evidence /c/logs --sandbox`,
    `${GATE} --head ${SHA} --objects /o --evidence /elsewhere --sandbox`,
    `${GATE} --head ${SHA} --evidence /c/logs/.. --sandbox`,
    `${GATE} --head ${SHA} --head ${OTHER} --evidence /c/logs --sandbox`,
    `${READ} --head ${OTHER} --objects /o names`,
    `${READ} --head`,
  ];
  for (const command of refused) {
    assertStringIncludes(bash(command) ?? "allowed", "review lock", command);
  }
});

Deno.test("under a lock whose entry names no head or folder, no script runs", () => {
  const command = `${GATE} --head ${SHA} --objects /o --evidence /c/logs --sandbox`;
  assertStringIncludes(bash(command, UNKNOWN_REVIEW) ?? "allowed", "review lock");
  const noFolder = { head: SHA, logs: null };
  assertStringIncludes(bash(command, noFolder) ?? "allowed", "review lock", "no logs folder");
  assertEquals(bash(`${READ} --head ${SHA} names`, noFolder), null, "a read needs no folder");
});
