import { assertEquals } from "@std/assert";
import { parseArgs } from "../../src/cli/parser.ts";

const SHA = "b".repeat(40);

Deno.test("review gate, guard, start and end parse into their intent", () => {
  assertEquals(parseArgs(["review", "gate"]), { kind: "review", sub: "gate" });
  assertEquals(parseArgs(["review", "guard"]), { kind: "review", sub: "guard" });
  assertEquals(parseArgs(["review", "start", "12"]), {
    kind: "review",
    sub: "start",
    source: "12",
  });
  assertEquals(parseArgs(["review", "end", SHA]), { kind: "review", sub: "end", sha: SHA });
});

Deno.test("review refuses a missing or extra argument, and an end that is not a full id", () => {
  for (
    const argv of [
      ["review"],
      ["review", "gate", "x"],
      ["review", "guard", "x"],
      ["review", "start"],
      ["review", "start", "a", "b"],
      ["review", "end", "HEAD"],
      ["review", "end"],
      ["review", "merge"],
    ]
  ) assertEquals(parseArgs(argv).kind, "unknown", argv.join(" "));
});

Deno.test("review start takes no option and no --, wherever it is", () => {
  for (
    const argv of [
      ["review", "--force", "start", "12"],
      ["review", "--", "start", "12"],
      ["review", "start", "--", "12"],
      ["review", "start", "12", "--force"],
      ["review", "start", "--toolchain", "/x", "12"],
    ]
  ) assertEquals(parseArgs(argv), { kind: "unknown", received: "review start takes no option" });
});
