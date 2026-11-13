import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  isInsideFolder,
  lockedCallRefusal,
  lockedExecRefusal,
  lockedLogOf,
  type LockedReview,
  UNKNOWN_REVIEW,
} from "../../src/domain/review_lock.ts";

/**
 * A sandboxed run under the review lock: the head the review exported, its log in the folder the
 * start made, and no toolchain, as the guard judges the call and as `sandbox exec` judges itself.
 */

const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);
const REVIEW: LockedReview = { head: SHA, logs: "/c/logs" };
const LOG = "/c/logs/1.log";
const bash = (command: string, review = REVIEW, log: string | null = LOG) =>
  lockedCallRefusal("Bash", { command }, review, log);

Deno.test("under the review lock, sandbox exec runs the review's head alone, logged in its folder", () => {
  const exec = (rest: string) => `specnaut sandbox exec ${rest}`;
  assertEquals(bash(exec(`${SHA} --log ${LOG} -- make`)), null);
  const nested = "/c/logs/gate-fast.x1/1.log";
  assertEquals(bash(exec(`${SHA} --log ${nested} -- make`), REVIEW, nested), null, "below it");
  const refused: [string, LockedReview, string | null, string][] = [
    [exec(`${OTHER} --log ${LOG} -- make`), REVIEW, LOG, "another commit"],
    [exec(`${SHA} -- make`), REVIEW, null, "no log"],
    [exec(`${SHA} --log ${LOG} --toolchain /opt -- make`), REVIEW, LOG, "a toolchain after"],
    [exec(`${SHA} --toolchain /opt --log ${LOG} -- make`), REVIEW, LOG, "a toolchain before"],
    [exec(`${SHA} --log=${LOG} -- make`), REVIEW, LOG, "the log joined to its flag"],
    [exec(`${SHA} --toolchain ${LOG} -- make`), REVIEW, LOG, "another flag in --log's place"],
    [exec(`${SHA} --log ${LOG} --`), REVIEW, LOG, "no command"],
    [exec(`${SHA} --log ${LOG} x -- make`), REVIEW, LOG, "a word before --"],
    [exec(`${SHA} --log ${LOG} -- make`), REVIEW, "/home/u/.profile", "it resolves elsewhere"],
    [exec(`${SHA} --log ${LOG} -- make`), REVIEW, null, "it resolves nowhere"],
    [exec(`${SHA} --log ${LOG} -- make`), REVIEW, "/c/logsx/1.log", "a sibling folder"],
    [exec(`${SHA} --log ${LOG} -- make`), REVIEW, "/c/logs", "the folder itself"],
    [exec(`${SHA} --log ${LOG} -- make`), UNKNOWN_REVIEW, LOG, "an entry naming nothing"],
    [exec(`${SHA} --log ${LOG} -- make`), { head: SHA, logs: null }, LOG, "no logs folder"],
  ];
  for (const [command, review, log, name] of refused) {
    assertStringIncludes(bash(command, review, log) ?? "allowed", "review lock", name);
  }
});

Deno.test("the log the guard must resolve is the one of exec's exact shape, and no other", () => {
  const log = (command: string, name = "Bash") => lockedLogOf(name, { command });
  assertEquals(log(`specnaut sandbox exec ${SHA} --log ${LOG} -- make`), LOG);
  assertEquals(log(`specnaut sandbox exec ${SHA} --log ${LOG} -- make`, "Read"), null);
  assertEquals(log(`specnaut sandbox exec ${SHA} --toolchain ${LOG} -- make`), null);
  assertEquals(log(`specnaut sandbox exec ${SHA} --log ${LOG}; make`), null);
  assertEquals(log("specnaut verify-scripts"), null);
});

const POSIX = Deno.build.os !== "windows";

Deno.test({
  name: "a path is inside a folder only below it, by the separator of the host",
  ignore: !POSIX,
  fn: () => {
    assertEquals(isInsideFolder("/c/logs/1.log", "/c/logs"), true);
    assertEquals(isInsideFolder("/c/logs/a/1.log", "/c/logs/"), true);
    // A `\` is a character of a name here: `logs\x` is a file beside `logs`, not in it.
    const beside = ["/c/logs\\x", "/c/logs\\a/1.log"];
    for (const path of ["/c/logs", "/c/logs/", "/c/logsx/1.log", "/c/log", "/d/1.log", ...beside]) {
      assertEquals(isInsideFolder(path, "/c/logs"), false, path);
    }
  },
});

Deno.test({
  name: "a path is inside a folder only below it, on Windows",
  ignore: POSIX,
  fn: () => {
    assertEquals(isInsideFolder("C:\\c\\logs\\1.log", "C:\\c\\logs"), true);
    assertEquals(isInsideFolder("C:\\c\\logs\\1.log", "C:\\c\\logs\\"), true);
    for (const path of ["C:\\c\\logs", "C:\\c\\logsx\\1.log", "C:\\d\\1.log"]) {
      assertEquals(isInsideFolder(path, "C:\\c\\logs"), false, path);
    }
  },
});

Deno.test("sandbox exec itself, under any lock of its checkout, logs only in a review's folder", () => {
  const other: LockedReview = { head: OTHER, logs: "/c/other" };
  assertEquals(lockedExecRefusal([], ["/opt"], null), null, "no lock: as it always ran");
  assertEquals(lockedExecRefusal([REVIEW], [], LOG), null);
  assertEquals(lockedExecRefusal([other, REVIEW], [], LOG), null, "any review's folder");
  const refused: [LockedReview[], string[], string | null, string][] = [
    [[REVIEW], ["/opt"], LOG, "a toolchain"],
    [[REVIEW], [], null, "no log, or one resolving nowhere"],
    [[REVIEW], [], "/home/u/.profile", "a log elsewhere"],
    [[UNKNOWN_REVIEW], [], LOG, "a lock naming no folder"],
  ];
  for (const [held, toolchain, log, name] of refused) {
    assertStringIncludes(lockedExecRefusal(held, toolchain, log) ?? "ran", "review lock", name);
  }
});
