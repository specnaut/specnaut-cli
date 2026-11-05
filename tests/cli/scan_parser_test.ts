import { assertEquals } from "@std/assert";
import { parseArgs } from "../../src/cli/parser.ts";
import { DEFAULT_TOP, isScanPath } from "../../src/cli/scan_parser.ts";

/** `specnaut scan`'s arguments, read through the real parser. */

Deno.test("scan: the defaults, and every flag read", () => {
  assertEquals(parseArgs(["scan"]), { kind: "scan", path: null, format: "text", top: DEFAULT_TOP });
  assertEquals(parseArgs(["scan", "--path", "src/cli", "--format", "json", "--top", "all"]), {
    kind: "scan",
    path: "src/cli",
    format: "json",
    top: "all",
  });
  assertEquals(parseArgs(["scan", "--top=0", "--format=mermaid"]), {
    kind: "scan",
    path: null,
    format: "mermaid",
    top: 0,
  });
});

/** The intent's refusal text, or what it accepted. */
function refused(argv: string[]): string {
  const intent = parseArgs(argv);
  return intent.kind === "unknown" ? intent.received : `accepted: ${JSON.stringify(intent)}`;
}

/** Each argument list, and the refusal it gets: none of them holds the value refused. */
const REFUSALS: ReadonlyArray<[string[], string]> = [
  [["scan", "--format", "\x1b[2Jx"], "scan --format takes text, json or mermaid"],
  [["scan", "--top", "-1"], "scan --top takes a whole number or all"],
  [["scan", "--top", "1e3"], "scan --top takes a whole number or all"],
  [
    ["scan", "--path", "../\x1bsecret"],
    "scan --path takes a relative path inside the repository, with no .. segment",
  ],
  [["scan", "src"], "scan takes no positional argument; name a subtree with --path"],
];

Deno.test("scan: a refusal never echoes the value it refused", () => {
  for (const [argv, why] of REFUSALS) assertEquals(refused(argv), why, JSON.stringify(argv));
  assertEquals(refused(["scan", "--path.x", "a"]).startsWith("scan --path"), true);
});

/** Each subtree `--path` may name, then each it may not. */
const SCAN_PATHS = ["src", "src/", "./src", ".", "a..b", "...", "é/ü", ":(top)x"];
// deno-fmt-ignore
const NOT_SCAN_PATHS = [
  "", "-x", "--all", "/etc", "\\x", "C:x", "c:\\x", "..", "a/../b", "a\\..\\b", "a/..", "a\nb",
  "a\x9bb",
];

Deno.test("isScanPath: relative on every platform, no .. segment, no option, no control", () => {
  for (const ok of SCAN_PATHS) assertEquals(isScanPath(ok), true, ok);
  for (const bad of NOT_SCAN_PATHS) assertEquals(isScanPath(bad), false, JSON.stringify(bad));
});
