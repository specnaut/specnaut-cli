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
    ai: null,
    force: false,
  });
});

Deno.test("parseArgs returns init intent with --here", () => {
  assertEquals(parseArgs(["init", "--here"]), {
    kind: "init",
    projectName: null,
    here: true,
    noGit: false,
    ai: null,
    force: false,
  });
});

Deno.test("parseArgs returns init intent with --no-git", () => {
  assertEquals(parseArgs(["init", "x", "--no-git"]), {
    kind: "init",
    projectName: "x",
    here: false,
    noGit: true,
    ai: null,
    force: false,
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

Deno.test("parseArgs returns unknown for backlog (sync command removed)", () => {
  assertEquals(parseArgs(["backlog"]), { kind: "unknown", received: "backlog" });
  assertEquals(parseArgs(["backlog", "sync"]), { kind: "unknown", received: "backlog" });
  assertEquals(parseArgs(["backlog", "configure"]), { kind: "unknown", received: "backlog" });
});

Deno.test("parseArgs returns check intent without --project", () => {
  assertEquals(parseArgs(["check"]), { kind: "check", projectMode: false });
});

Deno.test("parseArgs returns check intent with --project", () => {
  assertEquals(parseArgs(["check", "--project"]), { kind: "check", projectMode: true });
});

Deno.test("parseArgs init with --force", () => {
  assertEquals(parseArgs(["init", "demo", "--force"]), {
    kind: "init",
    projectName: "demo",
    here: false,
    noGit: false,
    ai: null,
    force: true,
  });
});

Deno.test("parseArgs init without --force defaults to false", () => {
  const result = parseArgs(["init", "demo"]);
  if (result.kind === "init") assertEquals(result.force, false);
});

Deno.test("parseArgs returns upgrade intent", () => {
  assertEquals(parseArgs(["upgrade"]), {
    kind: "upgrade",
    dryRun: false,
    force: false,
  });
});

Deno.test("parseArgs returns upgrade intent with --dry-run --force", () => {
  assertEquals(parseArgs(["upgrade", "--dry-run", "--force"]), {
    kind: "upgrade",
    dryRun: true,
    force: true,
  });
});

Deno.test("parseArgs accepts init --ai cursor", () => {
  const r = parseArgs(["init", "demo", "--ai", "cursor"]);
  if (r.kind === "init") assertEquals(r.ai, "cursor");
});

Deno.test("parseArgs returns unknown for invalid --ai value", () => {
  assertEquals(parseArgs(["init", "demo", "--ai", "bogus"]), {
    kind: "unknown",
    received: "init --ai bogus",
  });
});

Deno.test("parseArgs init leaves --ai null when not provided (resolved by handler)", () => {
  const r = parseArgs(["init", "demo"]);
  if (r.kind === "init") assertEquals(r.ai, null);
});

Deno.test("parseArgs accepts init --ai codex", () => {
  const r = parseArgs(["init", "demo", "--ai", "codex"]);
  if (r.kind === "init") assertEquals(r.ai, "codex");
});

Deno.test("parseArgs accepts init --ai gemini", () => {
  const r = parseArgs(["init", "demo", "--ai", "gemini"]);
  if (r.kind === "init") assertEquals(r.ai, "gemini");
});

Deno.test("parseArgs accepts init --ai windsurf", () => {
  const r = parseArgs(["init", "demo", "--ai", "windsurf"]);
  if (r.kind === "init") assertEquals(r.ai, "windsurf");
});

Deno.test("parseArgs accepts init --ai copilot", () => {
  const r = parseArgs(["init", "demo", "--ai", "copilot"]);
  if (r.kind === "init") assertEquals(r.ai, "copilot");
});

Deno.test("parseArgs accepts --ai opencode", () => {
  const intent = parseArgs(["init", "demo", "--ai", "opencode"]);
  assertEquals(intent.kind, "init");
  if (intent.kind === "init") assertEquals(intent.ai, "opencode");
});
