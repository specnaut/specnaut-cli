import { assertEquals } from "@std/assert";
import {
  type CoreBundle,
  type CoreCategory,
  type CoreEntry,
  entriesByCategory,
  findByName,
} from "../../src/domain/core_bundle.ts";

const SAMPLE: CoreBundle = [
  {
    category: "command",
    name: "specify",
    suffix: null,
    content: "# specify\n",
    executable: false,
  },
  {
    category: "command",
    name: "clarify",
    suffix: null,
    content: "# clarify\n",
    executable: false,
  },
  {
    category: "agent",
    name: "product-owner",
    suffix: null,
    content: "# PO\n",
    executable: false,
  },
  {
    category: "spec-root",
    name: "specify",
    suffix: "memory/constitution.md",
    content: "# constitution\n",
    executable: false,
  },
];

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

Deno.test("entriesByCategory groups entries by category", () => {
  const grouped = entriesByCategory(SAMPLE);
  assertEquals(grouped.get("command")?.length, 2);
  assertEquals(grouped.get("agent")?.length, 1);
  assertEquals(grouped.get("spec-root")?.length, 1);
  assertEquals(grouped.get("skill"), undefined);
});

Deno.test("findByName returns the matching entry", () => {
  const hit = findByName(SAMPLE, "command", "specify");
  assertEquals(hit?.content, "# specify\n");
  const miss = findByName(SAMPLE, "command", "absent");
  assertEquals(miss, null);
});

Deno.test("findByName considers suffix for spec-root/project-root", () => {
  const hit = findByName(SAMPLE, "spec-root", "specify", "memory/constitution.md");
  assertEquals(hit?.content, "# constitution\n");
  const miss = findByName(SAMPLE, "spec-root", "specify", "memory/missing.md");
  assertEquals(miss, null);
});

Deno.test("CoreEntry enforces the expected shape", () => {
  const entry: CoreEntry = {
    category: "skill",
    name: "speckit",
    suffix: null,
    content: "# skill\n",
    executable: false,
  };
  assertEquals(entry.category, "skill");
});
