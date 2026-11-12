import { assertEquals, assertRejects } from "@std/assert";
import { exportBranchTree } from "../../src/application/untrusted_review.ts";
import type { ExportStore, TreeObjects } from "../../src/application/untrusted_review_ports.ts";

const failure = new Error("the fetch broke");

/** A store whose removal fails, behind a fetch that fails first. */
function deps(removed: string[]) {
  const store: ExportStore = {
    stage: () => Promise.resolve("/staged/git"),
    claim: () => Promise.reject(new Error("unreached")),
    write: () => Promise.resolve(),
    verify: () => Promise.resolve(),
    remove: () => {
      removed.push("tried");
      return Promise.reject(new Error("a folder is busy"));
    },
    keep: () => {},
  };
  return {
    fetcher: { remotes: () => Promise.resolve(["origin"]), fetch: () => Promise.reject(failure) },
    objects: () => ({}) as TreeObjects,
    store: () => store,
    windows: false,
  };
}

Deno.test("a cleanup that fails after a failure keeps the first failure as its cause", async () => {
  const removed: string[] = [];
  const run = () => exportBranchTree(deps(removed), { source: "origin/topic" });
  const err = await assertRejects(run, Error, "removing it failed too: a folder is busy");
  assertEquals(err.cause, failure);
  assertEquals(removed, ["tried"]);
});
