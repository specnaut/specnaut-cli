import { assertEquals } from "@std/assert";
import { parseArgs } from "../../src/cli/parser.ts";

Deno.test("parseArgs returns version intent for --version", () => {
  assertEquals(parseArgs(["--version"]), { kind: "version" });
  assertEquals(parseArgs(["-v"]), { kind: "version" });
});

Deno.test("parseArgs returns help intent for --help or no args", () => {
  assertEquals(parseArgs(["--help"]), { kind: "help" });
  assertEquals(parseArgs(["-h"]), { kind: "help" });
  assertEquals(parseArgs([]), { kind: "help" });
});

Deno.test("parseArgs returns init intent with a project name", () => {
  assertEquals(parseArgs(["init", "my-project"]), {
    kind: "init",
    projectName: "my-project",
    here: false,
    noGit: false,
    ai: "claude",
  });
});

Deno.test("parseArgs returns init intent with --here", () => {
  assertEquals(parseArgs(["init", "--here"]), {
    kind: "init",
    projectName: null,
    here: true,
    noGit: false,
    ai: "claude",
  });
});

Deno.test("parseArgs returns init intent with --no-git", () => {
  assertEquals(parseArgs(["init", "x", "--no-git"]), {
    kind: "init",
    projectName: "x",
    here: false,
    noGit: true,
    ai: "claude",
  });
});

Deno.test("parseArgs returns unknown intent for invalid commands", () => {
  assertEquals(parseArgs(["bogus"]), { kind: "unknown", received: "bogus" });
});

Deno.test("parseArgs returns self-update intent with --check", () => {
  assertEquals(parseArgs(["self-update", "--check"]), {
    kind: "self-update",
    checkOnly: true,
  });
});

Deno.test("parseArgs returns self-update intent without --check", () => {
  assertEquals(parseArgs(["self-update"]), {
    kind: "self-update",
    checkOnly: false,
  });
});
