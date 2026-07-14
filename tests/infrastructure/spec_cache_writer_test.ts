import { assertEquals } from "@std/assert";
import { SpecCacheWriter } from "../../src/infrastructure/spec/spec_cache_writer.ts";
import type { SpecStep } from "../../src/domain/spec/spec_step.ts";

// Spec 020 / SC-004 — the gitignored materialisation cache. Writes ordered files
// under `.specnaut/specs/.cache/<task>/<order>-<slug>.md`, clears stale files on
// re-pull (US3 AC2), and reads content back (with a filename fallback when no
// manifest exists, so a hand-authored cloud spec is still pushable).

const writer = new SpecCacheWriter();

function steps(...s: Array<[string, string, number, string]>): SpecStep[] {
  return s.map(([key, name, order, body]) => ({ key, name, order, body }));
}

async function withTmp(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "spec_cache_" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("write lays out one ordered file per step and returns their paths", async () => {
  await withTmp(async (dir) => {
    const written = await writer.write(dir, 154, steps(
      ["specify", "Specify", 1, "# spec"],
      ["plan", "Plan", 2, "# plan"],
    ));
    assertEquals(written, [
      ".specnaut/specs/.cache/154/1-specify.md",
      ".specnaut/specs/.cache/154/2-plan.md",
    ]);
    assertEquals(await Deno.readTextFile(`${dir}/.specnaut/specs/.cache/154/1-specify.md`), "# spec");
    assertEquals(await Deno.readTextFile(`${dir}/.specnaut/specs/.cache/154/2-plan.md`), "# plan");
  });
});

Deno.test("write clears stale files on re-pull (US3 AC2 reconciliation)", async () => {
  await withTmp(async (dir) => {
    await writer.write(dir, 154, steps(
      ["specify", "Specify", 1, "a"],
      ["plan", "Plan", 2, "b"],
      ["tasks", "Tasks", 3, "c"],
    ));
    // A shorter re-pull must not leave the removed step's file behind.
    await writer.write(dir, 154, steps(["specify", "Specify", 1, "a2"]));
    const names: string[] = [];
    for await (const e of Deno.readDir(`${dir}/.specnaut/specs/.cache/154`)) names.push(e.name);
    assertEquals(names.includes("2-plan.md"), false);
    assertEquals(names.includes("3-tasks.md"), false);
    assertEquals(await Deno.readTextFile(`${dir}/.specnaut/specs/.cache/154/1-specify.md`), "a2");
  });
});

Deno.test("read round-trips written steps and reflects an edit to a cached tab", async () => {
  await withTmp(async (dir) => {
    await writer.write(dir, 154, steps(
      ["specify", "Specify", 1, "orig"],
      ["plan", "Plan", 2, "planbody"],
    ));
    // Simulate a user editing a materialised tab, then reading it back to push.
    await Deno.writeTextFile(`${dir}/.specnaut/specs/.cache/154/1-specify.md`, "edited");
    const read = await writer.read(dir, 154);
    assertEquals(read?.map((s) => [s.key, s.name, s.order, s.body]), [
      ["specify", "Specify", 1, "edited"],
      ["plan", "Plan", 2, "planbody"],
    ]);
  });
});

Deno.test("read reconstructs steps from filenames when no manifest exists (cloud specify)", async () => {
  await withTmp(async (dir) => {
    const cache = `${dir}/.specnaut/specs/.cache/9`;
    await Deno.mkdir(cache, { recursive: true });
    await Deno.writeTextFile(`${cache}/1-specify.md`, "hand-authored");
    const read = await writer.read(dir, 9);
    assertEquals(read?.length, 1);
    assertEquals(read?.[0].key, "specify");
    assertEquals(read?.[0].body, "hand-authored");
  });
});

Deno.test("read returns null when the task has no cache", async () => {
  await withTmp(async (dir) => {
    assertEquals(await writer.read(dir, 404), null);
  });
});

Deno.test("clear removes the task's cache dir and is idempotent", async () => {
  await withTmp(async (dir) => {
    await writer.write(dir, 154, steps(["specify", "Specify", 1, "x"]));
    await writer.clear(dir, 154);
    assertEquals(await writer.read(dir, 154), null);
    await writer.clear(dir, 154); // second clear is a no-op, not an error
  });
});
