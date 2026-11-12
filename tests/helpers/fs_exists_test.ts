import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { exists } from "./fs_exists.ts";

Deno.test("exists: true for an entry, false only when nothing is there", async () => {
  const dir = await Deno.makeTempDir({ prefix: "exists-" });
  try {
    await Deno.writeTextFile(join(dir, "f"), "x");
    assertEquals(await exists(join(dir, "f")), true);
    assertEquals(await exists(join(dir, "absent")), false);
    // A path through a regular file is not "absent": it could not be looked at.
    await assertRejects(() => exists(join(dir, "f", "below")), Deno.errors.NotADirectory);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
