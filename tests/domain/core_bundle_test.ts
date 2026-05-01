import { assertEquals } from "@std/assert";
import type { CoreCategory, CoreEntry } from "../../src/domain/core_bundle.ts";

Deno.test("CoreCategory is a narrow union", () => {
  const values: CoreCategory[] = [
    "command",
    "agent",
    "skill",
    "spec-root",
    "project-root",
    "backlog-cmd",
  ];
  assertEquals(values.length, 6);
});

Deno.test("CoreEntry enforces the expected shape", () => {
  const entry: CoreEntry = {
    category: "skill",
    name: "auto-chain",
    suffix: null,
    content: "# skill\n",
    executable: false,
  };
  assertEquals(entry.category, "skill");
});
