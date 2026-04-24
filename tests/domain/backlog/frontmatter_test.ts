import { assertEquals, assertThrows } from "@std/assert";
import { parseFrontmatter } from "../../../src/domain/backlog/frontmatter.ts";

const VALID = `---
id: "001"
title: "First task"
category: devex
priority: high
complexity: 5
status: todo
depends_on: []
spec: null
tags: [infra, bootstrap]
created: 2026-04-24
---

This is the task body.

Second paragraph.
`;

Deno.test("parseFrontmatter returns a BacklogTask for valid input", () => {
  const task = parseFrontmatter(VALID);
  assertEquals(task.id, "001");
  assertEquals(task.title, "First task");
  assertEquals(task.category, "devex");
  assertEquals(task.priority, "high");
  assertEquals(task.complexity, 5);
  assertEquals(task.status, "todo");
  assertEquals(task.dependsOn, []);
  assertEquals(task.spec, null);
  assertEquals(task.tags, ["infra", "bootstrap"]);
  assertEquals(task.created, "2026-04-24");
  assertEquals(task.body.trim().startsWith("This is the task body."), true);
});

Deno.test("parseFrontmatter accepts unquoted numeric id", () => {
  const task = parseFrontmatter(VALID.replace('"001"', "001"));
  assertEquals(task.id, "001");
});

Deno.test("parseFrontmatter coerces depends_on omitted to []", () => {
  const raw = VALID.replace("depends_on: []\n", "");
  const task = parseFrontmatter(raw);
  assertEquals(task.dependsOn, []);
});

Deno.test("parseFrontmatter rejects missing delimiter", () => {
  assertThrows(() => parseFrontmatter("no frontmatter here"), Error, "frontmatter");
});

Deno.test("parseFrontmatter rejects missing required field (title)", () => {
  const raw = VALID.replace(/title:.*\n/, "");
  assertThrows(() => parseFrontmatter(raw), Error, "title");
});

Deno.test("parseFrontmatter rejects invalid priority", () => {
  const raw = VALID.replace("priority: high", "priority: urgent");
  assertThrows(() => parseFrontmatter(raw), Error, "priority");
});

Deno.test("parseFrontmatter rejects non-Fibonacci complexity", () => {
  const raw = VALID.replace("complexity: 5", "complexity: 4");
  assertThrows(() => parseFrontmatter(raw), Error, "Fibonacci");
});

Deno.test("parseFrontmatter pads id to 3 digits", () => {
  const raw = VALID.replace('"001"', "7");
  const task = parseFrontmatter(raw);
  assertEquals(task.id, "007");
});
