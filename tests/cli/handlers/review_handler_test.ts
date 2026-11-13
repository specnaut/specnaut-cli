import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import type { BranchExport } from "../../../src/application/untrusted_review.ts";
import type { TrustDecision } from "../../../src/domain/review_trust.ts";
import { runReview, startLines } from "../../../src/cli/handlers/review_handler.ts";
import { removeKeptExport } from "../../../src/infrastructure/fs_tree_export.ts";
import { exists } from "../../helpers/fs_exists.ts";

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
    end: () => Promise.resolve(false),
    start: () =>
      Promise.resolve({
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

Deno.test("end removes the kept export by its id, and refuses a link at that name", async () => {
  const cache = await Deno.makeTempDir({ prefix: "review-end-" });
  try {
    await Deno.mkdir(join(cache, SHA, "seats"), { recursive: true });
    assertEquals(await removeKeptExport(cache, SHA), true);
    assertEquals(await exists(join(cache, SHA)), false);
    assertEquals(await removeKeptExport(cache, SHA), false);
    if (Deno.build.os !== "windows") {
      await Deno.mkdir(join(cache, "elsewhere"));
      await Deno.symlink(join(cache, "elsewhere"), join(cache, SHA));
      const err = await removeKeptExport(cache, SHA).catch((e: Error) => e.message);
      assertStringIncludes(String(err), "a link is not followed");
      assertEquals(await exists(join(cache, "elsewhere")), true);
    }
  } finally {
    await Deno.remove(cache, { recursive: true });
  }
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
