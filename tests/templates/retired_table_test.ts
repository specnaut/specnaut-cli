import { assertEquals } from "@std/assert";
import { successorAddresses } from "./retired_table.ts";

Deno.test("a successor cell yields every address it names, as skill + verb", () => {
  assertEquals(successorAddresses(" `/task plan <feature>`, step 1 "), ["/task plan"]);
  assertEquals(successorAddresses(" `/task audit --security` "), ["/task audit"]);
  assertEquals(successorAddresses(" `/task` (`list`, `--deps`, `next`) "), [
    "/task",
    "/task list",
    "/task next",
  ]);
});
