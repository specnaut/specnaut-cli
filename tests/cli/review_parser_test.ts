import { assertEquals } from "@std/assert";
import { parseArgs } from "../../src/cli/parser.ts";

const SHA = "b".repeat(40);

Deno.test("review gate, guard, start, trust and end parse into their intent", () => {
  assertEquals(parseArgs(["review", "gate"]), { kind: "review", sub: "gate" });
  assertEquals(parseArgs(["review", "guard"]), { kind: "review", sub: "guard" });
  assertEquals(parseArgs(["review", "start", "12"]), {
    kind: "review",
    sub: "start",
    source: "12",
  });
  assertEquals(parseArgs(["review", "end", SHA]), { kind: "review", sub: "end", sha: SHA });
  assertEquals(parseArgs(["review", "trust", "12", SHA]), {
    kind: "review",
    sub: "trust",
    pr: "12",
    head: SHA,
  });
  assertEquals(
    parseArgs(["review", "trust", "x", ""]),
    { kind: "review", sub: "trust", pr: "x", head: "" },
    "a malformed pair is the decision's to judge: it prints untrusted",
  );
});

Deno.test("review refuses a missing or extra argument, and an end that is not a full id", () => {
  for (
    const argv of [
      ["review"],
      ["review", "gate", "x"],
      ["review", "guard", "x"],
      ["review", "trust"],
      ["review", "trust", "12"],
      ["review", "trust", "12", SHA, "x"],
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

Deno.test("review start takes --expect <sha> as its last two words, and nowhere else", () => {
  assertEquals(parseArgs(["review", "start", "12", "--expect", SHA]), {
    kind: "review",
    sub: "start",
    source: "12",
    expect: SHA,
  });
  for (
    const [argv, why] of [
      [["review", "start", "12", "--expect", "HEAD"], "start --expect takes one full commit id"],
      [["review", "start", "12", "--expect", "-x"], "start --expect takes one full commit id"],
      [["review", "start", "12", "--expect"], "start takes no option"],
      [["review", "start", "--expect", SHA, "12"], "start takes no option"],
      [["review", "--expect", SHA, "start", "12"], "start takes no option"],
      [["review", "start", "12", `--expect=${SHA}`], "start takes no option"],
      [["review", "start", "12", "--force", "--expect", SHA], "start takes no option"],
      [["review", "start", "--expect", SHA], "start takes one source"],
      [["review", "start", "a", "b", "--expect", SHA], "start takes one source"],
    ] as const
  ) {
    assertEquals(
      parseArgs([...argv]),
      { kind: "unknown", received: `review ${why}` },
      argv.join(" "),
    );
  }
});
