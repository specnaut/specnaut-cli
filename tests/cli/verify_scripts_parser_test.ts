import { assertEquals } from "@std/assert";
import { parseArgs } from "../../src/cli/parser.ts";

/**
 * `verify-scripts` takes no word, or the digests a yes covers, each flag once and followed by a
 * sha256 written as 64 lowercase hex digits. Every other argument list is usage (exit 2).
 */

const A = "a".repeat(64);
const B = "0123456789".repeat(6) + "abcd";

Deno.test("verify-scripts with no argument approves nothing", () => {
  assertEquals(parseArgs(["verify-scripts"]), { kind: "verify-scripts", approved: {} });
});

Deno.test("verify-scripts reads each approved digest into its class", () => {
  assertEquals(parseArgs(["verify-scripts", "--approved-scripts", A]), {
    kind: "verify-scripts",
    approved: { scripts: A },
  });
  assertEquals(
    parseArgs(["verify-scripts", "--approved-instructions", B, "--approved-scripts", A]),
    { kind: "verify-scripts", approved: { scripts: A, instructions: B } },
  );
});

Deno.test("verify-scripts refuses every other argument list as usage", () => {
  const refused: string[][] = [
    ["verify-scripts", "extra"],
    ["verify-scripts", "--approved-scripts"],
    ["verify-scripts", "--approved-scripts", "abc"],
    ["verify-scripts", "--approved-scripts", A.toUpperCase()],
    ["verify-scripts", "--approved-scripts", `${A}0`],
    ["verify-scripts", "--approved-scripts", ` ${A}`],
    ["verify-scripts", `--approved-scripts=${A}`],
    ["verify-scripts", "--approved-scripts", A, "--approved-scripts", A],
    ["verify-scripts", "--approved-instructions", A, "--approved-instructions", B],
    ["verify-scripts", "--approved-config", A],
    ["verify-scripts", "--force"],
    ["verify-scripts", "--approved-scripts", A, "extra"],
    ["--force", "verify-scripts"],
  ];
  for (const argv of refused) {
    assertEquals(parseArgs(argv).kind, "unknown", argv.join(" "));
  }
});
