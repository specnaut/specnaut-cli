// The parse golden's cases for the commands added after golden.ts reached its size target
// (`specnaut scan`, cli#747, and `specnaut verify-scripts`): parser.ts's own answer for each
// command line, which internal/cli/parse_test.go holds the Go parser to. A later command's cases
// go here too, never into golden.ts.
//
// Regenerate after changing a case or the TypeScript side (CI regenerates it and fails on a diff):
//   deno run --allow-read --allow-write internal/testdata/golden_commands.ts
import { parseArgs } from "../../src/cli/parser.ts";

// deno-fmt-ignore
const argv: string[][] = [
  ["scan"], ["scan", "x"], ["scan", "1"], ["--path", "x", "scan"], ["init", "--path", "x"],
  ["scan", "--help"], ["scan", "--format", "json", "--version"],
  ["scan", "--format"], ["scan", "--format", "json"], ["scan", "--format", "JSON"],
  ["scan", "--format=mermaid"], ["scan", "--format", "text"], ["scan", "--format", ""],
  ["scan", "--format.x", "a"], ["scan", "--no-format"], ["scan", "--format", "json", "--format", "x"],
  ["scan", "--top"], ["scan", "--top", "0"], ["scan", "--top", "007"], ["scan", "--top", "all"],
  ["scan", "--top", "ALL"], ["scan", "--top", "-1"], ["scan", "--top", "1e3"], ["scan", "--top", ""],
  ["scan", "--top", "123456789"], ["scan", "--top", "1234567890"], ["scan", "--top", " 5"],
  ["scan", "--top", "5.0"], ["scan", "--top=12"],
  ["scan", "--path", "src"], ["scan", "--path", "src/"], ["scan", "--path", "./src"],
  ["scan", "--path", "."], ["scan", "--path", "..."], ["scan", "--path", "a..b"],
  ["scan", "--path", ""], ["scan", "--path"], ["scan", "--path", "/etc"], ["scan", "--path", "\\x"],
  ["scan", "--path", "C:x"], ["scan", "--path", "c:\\x"], ["scan", "--path", ".."],
  ["scan", "--path", "a/../b"], ["scan", "--path", "a\\..\\b"], ["scan", "--path", "a/.."],
  ["scan", "--path=-x"], ["scan", "--path", "-x"], ["scan", "--path", "a\x1bb"],
  ["scan", "--path", "a\x9bb"], ["scan", "--path", "a\x7f"], ["scan", "--path", "a\nb"],
  ["scan", "--path", "é/ü"], ["scan", "--path", ":(top)x"], ["scan", "--path", "a", "--path", "b"],
  ["scan", "--path.x", "a"], ["scan", "--no-path"],
  ["scan", "--path", "src", "--top", "3", "--format", "json"], ["scan", "x", "--format", "bogus"],
  ["scan", "--format", "bogus", "--top", "x"], ["scan", "--top", "x", "--path", "/a"],
  // `specnaut verify-scripts`: no argument, and the global flags ignored as every command ignores them.
  ["verify-scripts"], ["verify-scripts", "x"], ["verify-scripts", "--path", "x"],
  ["verify-scripts", "--help"], ["verify-scripts", "a", "b"], ["--force", "verify-scripts"],
];

function intentOf(args: string[]): unknown {
  try {
    return parseArgs(args);
  } catch (err) {
    return { crash: err instanceof Error ? err.name : String(err) };
  }
}

await Deno.writeTextFile(
  new URL("../cli/testdata/parse_commands_golden.jsonl", import.meta.url),
  argv.map((args) => JSON.stringify({ args, intent: intentOf(args) })).join("\n") + "\n",
);
