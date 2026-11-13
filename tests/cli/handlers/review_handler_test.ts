import { assertEquals, assertStringIncludes } from "@std/assert";
import type { BranchExport } from "../../../src/application/untrusted_review.ts";
import type { TrustDecision } from "../../../src/domain/review_trust.ts";
import type { CloseOutcome } from "../../../src/application/untrusted_review_close.ts";
import {
  branchExporter,
  CHANGED_COPY,
  runReview,
  startLines,
} from "../../../src/cli/handlers/review_handler.ts";
import { parseArgs } from "../../../src/cli/parser.ts";
import type { ReviewIntent } from "../../../src/cli/intent.ts";
import { blob, commit, tree } from "../../helpers/git_fixture.ts";
import { depsOf, fetcherOf, withWorld } from "../../helpers/export_world.ts";

const SHA = "c".repeat(40);

Deno.test("start prints where the export is, every path and listed name made inert", () => {
  const exported = {
    sha: SHA,
    seats: "/cache/s",
    scratch: "/cache/x",
    gitDir: "/cache/git",
    logs: "/cache/l",
    listed: [{ kind: "instruction", sha: "d".repeat(40), path: "CLAUDE\u001b[2J.md" }],
  } as unknown as BranchExport;
  assertEquals(startLines(exported), [
    `HEAD ${SHA}`,
    "SEATS /cache/s",
    "SCRATCH /cache/x",
    "OBJECTS /cache/git/objects",
    "LOGS /cache/l",
    `LISTED instruction ${"d".repeat(40)} CLAUDE\\u001b[2J.md`,
  ]);
});

Deno.test("start without a pass fails with exit 1 and fetches nothing", async () => {
  const said: string[] = [];
  const deps = {
    out: (s: string) => said.push(s),
    err: (s: string) => said.push(s),
    gate: () => Promise.resolve(0),
    guard: () => Promise.resolve(0),
    trust: () => Promise.reject(new Error("unreached")),
    end: () => Promise.reject(new Error("unreached")),
    start: () =>
      Promise.resolve({
        nonce: null,
        pass: {
          take: () => Promise.resolve(null),
          grant: () => Promise.resolve(),
          revoke: () => Promise.resolve(),
        },
        now: Date.now,
        baseTip: () => Promise.resolve(null),
        checkout: () => Promise.reject(new Error("read")),
        lock: () => Promise.reject(new Error("locked")),
        record: () => Promise.reject(new Error("recorded")),
        exportBranch: () => Promise.reject(new Error("fetched")),
      }),
  };
  assertEquals(await runReview({ kind: "review", sub: "start", source: "12" }, deps), 1);
  assertStringIncludes(said.join("\n"), "no checkout verdict");
});

Deno.test("end says whether it removed an export, and fails when the copy changed", async () => {
  const said: string[] = [];
  const run = (closed: CloseOutcome) =>
    runReview({ kind: "review", sub: "end", sha: SHA }, {
      out: (s) => said.push(`out ${s}`),
      err: (s) => said.push(`err ${s}`),
      gate: () => Promise.reject(new Error("unreached")),
      guard: () => Promise.reject(new Error("unreached")),
      trust: () => Promise.reject(new Error("unreached")),
      end: () => Promise.resolve(closed),
      start: () => Promise.reject(new Error("unreached")),
    });
  assertEquals(await run({ kind: "removed" }), 0);
  assertEquals(await run({ kind: "none" }), 0);
  assertEquals(await run({ kind: "changed", why: "seats/a differs from the commit" }), 1);
  assertEquals(said.slice(0, 2), [`out REMOVED ${SHA}`, `out NONE ${SHA}`]);
  assertStringIncludes(said[2], CHANGED_COPY);
  assertStringIncludes(said[2], "seats/a differs from the commit");
});

Deno.test("end that throws is reported through the handler's own failure, escaped", async () => {
  const said: string[] = [];
  const code = await runReview({ kind: "review", sub: "end", sha: SHA }, {
    out: (s) => said.push(`out ${s}`),
    err: (s) => said.push(`err ${s}`),
    gate: () => Promise.reject(new Error("unreached")),
    guard: () => Promise.reject(new Error("unreached")),
    trust: () => Promise.reject(new Error("unreached")),
    end: () => Promise.reject(new Error("removal refused \x1b[2J")),
    start: () => Promise.reject(new Error("unreached")),
  });
  assertEquals(code, 1);
  assertStringIncludes(said.join("\n"), "removal refused");
  assertEquals(said.join("\n").includes("\x1b[2J"), false);
});

Deno.test("guard and gate each run their own hook's check, and answer with its exit", async () => {
  const ran: string[] = [];
  const deps = {
    out: () => {},
    err: () => {},
    gate: () => Promise.resolve(void ran.push("gate")).then(() => 0),
    guard: () => Promise.resolve(void ran.push("guard")).then(() => 2),
    trust: () => Promise.reject(new Error("unreached")),
    end: () => Promise.reject(new Error("unreached")),
    start: () => Promise.reject(new Error("unreached")),
  };
  assertEquals(await runReview({ kind: "review", sub: "guard" }, deps), 2);
  assertEquals(await runReview({ kind: "review", sub: "gate" }, deps), 0);
  assertEquals(ran, ["guard", "gate"]);
});

Deno.test("trust prints its one line, inert, and exits 0 only when trusted", async () => {
  const cases: [TrustDecision, string, number][] = [
    [{ trusted: true }, "trusted", 0],
    [{ trusted: false, why: "the head moved" }, "untrusted the head moved", 1],
    [{ trusted: false, why: "gh: \u001b[2J" }, "untrusted gh: \\u001b[2J", 1],
  ];
  for (const [decision, line, code] of cases) {
    const said: string[] = [];
    const asked: string[] = [];
    const deps = {
      out: (s: string) => said.push(s),
      err: (s: string) => said.push(`err ${s}`),
      gate: () => Promise.reject(new Error("unreached")),
      guard: () => Promise.reject(new Error("unreached")),
      trust: (pr: string, head: string) =>
        Promise.resolve(void asked.push(`${pr} ${head}`)).then(() => decision),
      end: () => Promise.reject(new Error("unreached")),
      start: () => Promise.reject(new Error("unreached")),
    };
    const intent = { kind: "review", sub: "trust", pr: "12", head: SHA } as const;
    assertEquals(await runReview(intent, deps), code, line);
    assertEquals(said, [line]);
    assertEquals(asked, [`12 ${SHA}`]);
  }
});

/** `specnaut review start <argv…>` on a pass that holds, its export the real one over `head`. */
async function startOver(argv: string[], exportBranch: ReturnType<typeof branchExporter>) {
  const said: string[] = [];
  const judged = { head: "e".repeat(40), ref: null, reflog: null };
  const tip = "d".repeat(40);
  const pass = { granted: Date.now() - 1000, baseTip: tip, checkout: judged, session: "s-1" };
  const code = await runReview(parseArgs(["review", "start", ...argv]) as ReviewIntent, {
    out: (s) => said.push(`out ${s}`),
    err: (s) => said.push(`err ${s}`),
    gate: () => Promise.reject(new Error("unreached")),
    guard: () => Promise.reject(new Error("unreached")),
    trust: () => Promise.reject(new Error("unreached")),
    end: () => Promise.reject(new Error("unreached")),
    start: () =>
      Promise.resolve({
        pass: { take: () => Promise.resolve(pass), grant: unreached, revoke: unreached },
        now: Date.now,
        baseTip: () => Promise.resolve(tip),
        checkout: () => Promise.resolve(judged),
        lock: () => Promise.resolve(),
        record: () => Promise.resolve(),
        exportBranch,
      }),
  });
  return { code, said: said.join("\n") };
}

const unreached = () => Promise.reject(new Error("unreached"));

Deno.test("start --expect refuses a fetched head other than the one the forge reported", () =>
  withWorld(async (w) => {
    const head = await commit(
      w.repo,
      await tree(w.repo, [["100644", "a", await blob(w.repo, "x")]]),
    );
    const exporter = () => branchExporter(depsOf(w, fetcherOf(w, head)));
    const other = "f".repeat(40);
    const refused = await startOver(["origin/topic", "--expect", other], exporter());
    assertEquals(refused.code, 1, refused.said);
    assertStringIncludes(refused.said, `the fetched head is ${head}, not ${other}`);
    const started = await startOver(["origin/topic", "--expect", head], exporter());
    assertEquals(started.code, 0, started.said);
    assertStringIncludes(started.said, `out HEAD ${head}`);
  }));
