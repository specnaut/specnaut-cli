import { assertEquals } from "@std/assert";
import { stripAnsiCode } from "@std/fmt/colors";
import { printOrgs, renderBoard } from "../../src/cli/handlers/cloud_read_commands.ts";

/** What `cloud orgs` and `cloud board` print, colours aside. */

function printed(fn: () => void): string[] {
  const lines: string[] = [];
  const log = console.log;
  console.log = (line: string) => lines.push(stripAnsiCode(line));
  try {
    fn();
  } finally {
    console.log = log;
  }
  return lines;
}

Deno.test("cloud orgs: each organization with its role, the active one flagged", () => {
  const orgs = [
    { slug: "acme", name: "Acme", role: "owner", isActive: true },
    { slug: "demo", name: "Demo", role: "member", isActive: false },
  ];
  assertEquals(printed(() => printOrgs(orgs)), [
    "Your organizations:",
    "  ● Acme acme — owner (active)",
    "  ○ Demo demo — member",
  ]);
  assertEquals(printed(() => printOrgs([])), ["No organizations."]);
});

Deno.test("cloud board: columns in order, each with its count and its tasks", () => {
  const columns = [
    { id: "c2", name: "Done", order: 2 },
    { id: "c1", name: "Ready", order: 1 },
    { id: "c3", name: "Blocked", order: 3 },
  ];
  const tasks = [
    { number: 7, title: "Ship it", columnId: "c2", priority: null, size: null },
    { number: 3, title: "Plan it", columnId: "c1", priority: "P1", size: "M" },
    { number: 4, title: "Size it", columnId: "c1", priority: null, size: "S" },
  ];
  assertEquals(printed(() => renderBoard("ACME", columns, tasks)), [
    "Board — ACME",
    "\nReady (2)",
    "  #3 Plan it  [P1 M]",
    "  #4 Size it  [S]",
    "\nDone (1)",
    "  #7 Ship it",
    "\nBlocked (0)",
    "  —",
  ]);
});
