import { assertEquals } from "@std/assert";
import { parseArgs } from "../../src/cli/parser.ts";

/** `specnaut sandbox probe|exec`'s arguments, read through the real parser. */

const SHA = "0123456789abcdef0123456789abcdef01234567";

Deno.test("sandbox probe: no argument", () => {
  assertEquals(parseArgs(["sandbox", "probe"]), { kind: "sandbox", sub: "probe" });
});

Deno.test("sandbox exec: the commit, the toolchain, and the command after --, untouched", () => {
  const argv = [
    "sandbox",
    "exec",
    SHA,
    "--toolchain",
    "/opt/a/bin:/opt/b",
    "--",
    "deno",
    "--version",
  ];
  assertEquals(parseArgs(argv), {
    kind: "sandbox",
    sub: "exec",
    sha: SHA,
    toolchain: ["/opt/a/bin", "/opt/b"],
    command: ["deno", "--version"],
    log: null,
  });
  assertEquals(parseArgs(["sandbox", "exec", SHA, "--", "make", "007", "-h", "--", "x"]), {
    kind: "sandbox",
    sub: "exec",
    sha: SHA,
    toolchain: [],
    command: ["make", "007", "-h", "--", "x"],
    log: null,
  });
  const logged = parseArgs(["sandbox", "exec", SHA, "--log", "/tmp/run.log", "--", "make"]);
  assertEquals(logged.kind === "sandbox" && logged.sub === "exec" && logged.log, "/tmp/run.log");
});

function refused(argv: string[]): string {
  const intent = parseArgs(argv);
  return intent.kind === "unknown" ? intent.received : `accepted: ${JSON.stringify(intent)}`;
}

const REFUSALS: ReadonlyArray<[string[], string]> = [
  [
    ["sandbox", "exec", SHA, "--log", "run.log", "--", "make"],
    "sandbox exec --log takes an absolute file path",
  ],
  [["sandbox"], "sandbox"],
  [["sandbox", "bogus"], "sandbox bogus"],
  [["sandbox", "probe", "x"], "sandbox probe takes no argument"],
  [["sandbox", "probe", "--", "x"], "sandbox probe takes no argument"],
  [["sandbox", "exec"], "sandbox exec takes one full commit id before --"],
  [["sandbox", "exec", "--", "make"], "sandbox exec takes one full commit id before --"],
  [["sandbox", "exec", "abc123", "--", "make"], "sandbox exec takes one full commit id before --"],
  [
    ["sandbox", "exec", SHA.toUpperCase(), "--", "make"],
    "sandbox exec takes one full commit id before --",
  ],
  [["sandbox", "exec", SHA, "x", "--", "make"], "sandbox exec takes one full commit id before --"],
  [
    ["sandbox", "exec", "1".repeat(40), "--", "make"],
    "sandbox exec takes one full commit id before --",
  ],
  [["sandbox", "exec", SHA], "sandbox exec needs a command after --"],
  [["sandbox", "exec", SHA, "--"], "sandbox exec needs a command after --"],
  [["sandbox", "--", "exec", SHA, "make"], "sandbox takes its sub-command before --"],
  [["sandbox", "exec", "--", SHA, "make"], "sandbox exec takes one full commit id before --"],
  [
    ["sandbox", "exec", SHA, "--toolchain", "rel/bin", "--", "make"],
    "sandbox exec --toolchain takes absolute folders separated by :",
  ],
  [
    ["sandbox", "exec", SHA, "--toolchain", "/a::/b", "--", "make"],
    "sandbox exec --toolchain takes absolute folders separated by :",
  ],
  // parseArgs also keeps an empty value as a positional, so the commit id is the first refusal.
  [
    ["sandbox", "exec", SHA, "--toolchain", "", "--", "make"],
    "sandbox exec takes one full commit id before --",
  ],
];

Deno.test("sandbox: every malformed call is refused at parse time, before anything runs", () => {
  for (const [argv, why] of REFUSALS) assertEquals(refused(argv), why, argv.join(" "));
});

Deno.test("sandbox exec: --no-toolchain is no toolchain", () => {
  const intent = parseArgs(["sandbox", "exec", SHA, "--no-toolchain", "--", "make"]);
  assertEquals(intent.kind === "sandbox" && intent.sub === "exec" && intent.toolchain, []);
});

Deno.test("sandbox: --help and --version before -- win, as for every command", () => {
  assertEquals(parseArgs(["sandbox", "exec", SHA, "--help", "--", "make"]), { kind: "help" });
  assertEquals(parseArgs(["sandbox", "probe", "-v"]), { kind: "version" });
});
