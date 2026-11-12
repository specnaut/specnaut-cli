import { assertEquals } from "@std/assert";
import { lockShaInput } from "../../src/domain/template.ts";

Deno.test("lockShaInput: a merge block is hashed on its canonical body, anything else on its content", () => {
  // The one statement of what the lock hashes (#163): init and both upgrade
  // builders read it, so a merge block must lose its surrounding newlines here
  // exactly as `extractBlock` loses them from the file on disk.
  assertEquals(
    lockShaInput({ content: "\n\nbody\n\n", executable: false, mergeBlock: "gitignore" }),
    "body",
  );
  assertEquals(lockShaInput({ content: "\nplain\n", executable: false }), "\nplain\n");
});
