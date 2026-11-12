import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { CheckoutState } from "../../src/domain/review_gate.ts";
import { FsReviewPass } from "../../src/infrastructure/fs_review_pass.ts";

const JUDGED: CheckoutState = { head: "b".repeat(40), ref: null, reflog: "c0" };

Deno.test("a pass names the checkout it was granted for; one that does not say names none", async () => {
  const dir = await Deno.makeTempDir({ prefix: "review-pass-" });
  try {
    await new Deno.Command("git", { args: ["init", "-q", dir] }).output();
    const pass = (await FsReviewPass.open(dir, () => 7))!;
    await pass.grant("a".repeat(40), JUDGED);
    assertEquals(await pass.take(), { granted: 7, baseTip: "a".repeat(40), checkout: JUDGED });
    const file = join(dir, ".git", "specnaut", "review-pass.json");
    for (const checkout of [undefined, null, [], "x", { ...JUDGED, reflog: 1 }, { head: "b" }]) {
      await Deno.writeTextFile(file, JSON.stringify({ granted: 7, baseTip: "a", checkout }));
      assertEquals((await pass.take())?.checkout, null, JSON.stringify(checkout));
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
