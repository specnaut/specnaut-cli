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
const BASE = "c".repeat(40);
const REVIEW: LockedReview = { head: SHA, logs: "/c/logs", base: BASE };
const bash = (command: string, review = REVIEW) =>
  lockedCallRefusal("Bash", { command }, review, null);
const GATE = "bash .specnaut/scripts/bash/run-gate.sh fast";
const READ = "bash .specnaut/scripts/bash/git-read.sh";

Deno.test("under the review lock, a script reads the review's head and logs in its folder", () => {
  assertEquals(
    bash(`${GATE} --head ${SHA} --objects /o --evidence /c/logs --sandbox --base ${BASE}`),
    null,
  );
  assertEquals(bash(`${READ} --head ${SHA} --objects /o patch ${OTHER} ${SHA} a.ts`), null);
  const refused = [
    `${GATE} --head ${OTHER} --objects /o --evidence /c/logs --sandbox --base ${BASE}`,
    `${GATE} --head ${SHA} --objects /o --evidence /elsewhere --sandbox --base ${BASE}`,
    `${GATE} --head ${SHA} --evidence /c/logs/.. --sandbox --base ${BASE}`,
    `${GATE} --head ${SHA} --head ${OTHER} --evidence /c/logs --sandbox --base ${BASE}`,
    `${READ} --head ${OTHER} --objects /o names`,
    `${READ} --head`,
  ];
  for (const command of refused) {
    assertStringIncludes(bash(command) ?? "allowed", "review lock", command);
  }
});

Deno.test("under a lock whose entry names no head or folder, no script runs", () => {
  const command = `${GATE} --head ${SHA} --objects /o --evidence /c/logs --sandbox --base ${BASE}`;
  assertStringIncludes(bash(command, UNKNOWN_REVIEW) ?? "allowed", "review lock");
  const noFolder = { head: SHA, logs: null };
  assertStringIncludes(bash(command, noFolder) ?? "allowed", "review lock", "no logs folder");
  assertEquals(bash(`${READ} --head ${SHA} names`, noFolder), null, "a read needs no folder");
});

Deno.test("under the review lock, the gate runner's --base is the base tip the start recorded", () => {
  const run = (base: string) => `${GATE} --head ${SHA} --evidence /c/logs --sandbox ${base}`;
  assertEquals(bash(run(`--base ${BASE}`)), null);
  for (
    const base of [
      "",
      `--base ${SHA}`,
      `--base ${OTHER}`,
      "--base main",
      `--base ${BASE.slice(0, 12)}`,
      `--base ${BASE} --base ${OTHER}`,
    ]
  ) assertStringIncludes(bash(run(base)) ?? "allowed", "review lock", base || "no --base");
  const before = { head: SHA, logs: "/c/logs" };
  assertStringIncludes(
    bash(run(`--base ${BASE}`), before) ?? "allowed",
    "review lock",
    "no base recorded",
  );
  const scope = "bash .specnaut/scripts/audit/collect-audit-scope.sh";
  assertStringIncludes(bash(`${scope} --base ${OTHER} --head ${SHA}`) ?? "allowed", "review lock");
});
