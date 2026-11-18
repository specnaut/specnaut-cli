import { assertEquals } from "@std/assert";
import { parseArgs } from "../../src/cli/parser.ts";

/**
 * `record-approvals` takes the digest the user said yes to and the two commits it was judged at,
 * each flag exactly once and in any order: the digest as 64 lowercase hex digits, each commit as a
 * full sha. Every other argument list is usage (exit 2).
 */

const D = "d".repeat(64);
const HEAD = "1".repeat(40);
const TIP = "2".repeat(40);
const intent = { kind: "record-approvals", digest: D, head: HEAD, baseTip: TIP } as const;

Deno.test("record-approvals reads the digest and the two commits, in any order", () => {
  const args = ["--instructions-digest", D, "--head", HEAD, "--base-tip", TIP];
  assertEquals(parseArgs(["record-approvals", ...args]), intent);
  assertEquals(parseArgs(["record-approvals", ...args.slice(2), ...args.slice(0, 2)]), intent);
});

Deno.test("record-approvals refuses every other argument list as usage", () => {
  const full = ["--instructions-digest", D, "--head", HEAD, "--base-tip", TIP];
  const refused: string[][] = [
    [],
    full.slice(0, 4),
    [...full, "--head", HEAD],
    [...full, "extra"],
    ["--instructions-digest", D.toUpperCase(), ...full.slice(2)],
    ["--instructions-digest", D, "--head", "HEAD", ...full.slice(4)],
    ["--instructions-digest", D, "--head", HEAD.slice(1), ...full.slice(4)],
    [...full.slice(0, 4), "--base-tip", "origin/main"],
    ["--approved-instructions", D, ...full.slice(2)],
  ];
  for (const args of refused) {
    assertEquals(parseArgs(["record-approvals", ...args]).kind, "unknown", args.join(" "));
  }
});
