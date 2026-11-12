import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import type { BranchExport } from "../../../src/application/untrusted_review.ts";
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
    listed: [{ kind: "instruction", sha: "d".repeat(40), path: "CLAUDE\u001b[2J.md" }],
  } as unknown as BranchExport;
  assertEquals(startLines(exported), [
    `HEAD ${SHA}`,
    "SEATS /cache/s",
    "SCRATCH /cache/x",
    "OBJECTS /cache/git/objects",
    `LISTED instruction ${"d".repeat(40)} CLAUDE\\u001b[2J.md`,
  ]);
});

Deno.test("start without a pass fails with exit 1 and fetches nothing", async () => {
  const said: string[] = [];
  const deps = {
    out: (s: string) => said.push(s),
    err: (s: string) => said.push(s),
    gate: () => Promise.resolve(0),
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
