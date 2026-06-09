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
    backlog: null,
    backlogUrl: null,
    backlogRepo: null,
    scheme: null,
    force: false,
    dryRun: false,
    resetPreserved: false,
  });
});

Deno.test("parseArgs returns init intent with --here", () => {
  assertEquals(parseArgs(["init", "--here"]), {
    kind: "init",
    projectName: null,
    here: true,
    noGit: false,
    ai: null,
    backlog: null,
    backlogUrl: null,
    backlogRepo: null,
    scheme: null,
    force: false,
    dryRun: false,
    resetPreserved: false,
  });
});

Deno.test("parseArgs returns init intent with --no-git", () => {
  assertEquals(parseArgs(["init", "x", "--no-git"]), {
    kind: "init",
    projectName: "x",
    here: false,
    noGit: true,
    ai: null,
    backlog: null,
    backlogUrl: null,
    backlogRepo: null,
    scheme: null,
    force: false,
    dryRun: false,
    resetPreserved: false,
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
    backlog: null,
    backlogUrl: null,
    backlogRepo: null,
    scheme: null,
    force: true,
    dryRun: false,
    resetPreserved: false,
  });
});

Deno.test("parseArgs init with --dry-run", () => {
  assertEquals(parseArgs(["init", "demo", "--dry-run"]), {
    kind: "init",
    projectName: "demo",
    here: false,
    noGit: false,
    ai: null,
    backlog: null,
    backlogUrl: null,
    backlogRepo: null,
    scheme: null,
    force: false,
    dryRun: true,
    resetPreserved: false,
  });
});

Deno.test("parseArgs init with --force --dry-run captures both flags", () => {
  const r = parseArgs(["init", "--here", "--force", "--dry-run"]);
  if (r.kind === "init") {
    assertEquals(r.force, true);
    assertEquals(r.dryRun, true);
  }
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
    backlog: null,
    resetBaseline: false,
    resetPreserved: false,
  });
});

Deno.test("parseArgs returns upgrade intent with --dry-run --force", () => {
  assertEquals(parseArgs(["upgrade", "--dry-run", "--force"]), {
    kind: "upgrade",
    dryRun: true,
    force: true,
    backlog: null,
    resetBaseline: false,
    resetPreserved: false,
  });
});

Deno.test("parseArgs returns upgrade intent with --reset-baseline", () => {
  assertEquals(parseArgs(["upgrade", "--reset-baseline"]), {
    kind: "upgrade",
    dryRun: false,
    force: false,
    backlog: null,
    resetBaseline: true,
    resetPreserved: false,
  });
});

Deno.test("parseArgs returns diff intent (default onlyCustomised false)", () => {
  assertEquals(parseArgs(["diff"]), { kind: "diff", onlyCustomised: false });
});

Deno.test("parseArgs returns diff intent with --only-customised", () => {
  assertEquals(parseArgs(["diff", "--only-customised"]), {
    kind: "diff",
    onlyCustomised: true,
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

Deno.test("parseArgs accepts init --ai windsurf", () => {
  const r = parseArgs(["init", "demo", "--ai", "windsurf"]);
  if (r.kind === "init") assertEquals(r.ai, "windsurf");
});

Deno.test("parseArgs accepts init --backlog local", () => {
  const r = parseArgs(["init", "demo", "--backlog", "local"]);
  if (r.kind === "init") assertEquals(r.backlog, "local");
});

Deno.test("parseArgs accepts init --backlog github", () => {
  const r = parseArgs(["init", "demo", "--backlog", "github"]);
  if (r.kind === "init") assertEquals(r.backlog, "github");
});

Deno.test("parseArgs accepts init --backlog gitlab", () => {
  const r = parseArgs(["init", "demo", "--backlog", "gitlab"]);
  if (r.kind === "init") assertEquals(r.backlog, "gitlab");
});

Deno.test("parseArgs returns unknown for invalid init --backlog value", () => {
  assertEquals(parseArgs(["init", "demo", "--backlog", "bitbucket"]), {
    kind: "unknown",
    received: "init --backlog bitbucket",
  });
});

Deno.test("parseArgs init leaves --backlog null when not provided", () => {
  const r = parseArgs(["init", "demo"]);
  if (r.kind === "init") assertEquals(r.backlog, null);
});

Deno.test("parseArgs accepts upgrade --backlog github", () => {
  const r = parseArgs(["upgrade", "--backlog", "github"]);
  if (r.kind === "upgrade") assertEquals(r.backlog, "github");
});

Deno.test("parseArgs accepts upgrade --backlog gitlab", () => {
  const r = parseArgs(["upgrade", "--backlog", "gitlab"]);
  if (r.kind === "upgrade") assertEquals(r.backlog, "gitlab");
});

Deno.test("parseArgs returns unknown for invalid upgrade --backlog value", () => {
  assertEquals(parseArgs(["upgrade", "--backlog", "bitbucket"]), {
    kind: "unknown",
    received: "upgrade --backlog bitbucket",
  });
});

Deno.test("parseArgs upgrade leaves --backlog null when not provided", () => {
  const r = parseArgs(["upgrade"]);
  if (r.kind === "upgrade") assertEquals(r.backlog, null);
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

Deno.test("parseArgs accepts --backlog-url", () => {
  const intent = parseArgs([
    "init",
    "--here",
    "--backlog",
    "github",
    "--backlog-url",
    "https://github.com/orgs/myorg/projects/1",
  ]);
  assertEquals(intent.kind, "init");
  if (intent.kind === "init") {
    assertEquals(
      intent.backlogUrl,
      "https://github.com/orgs/myorg/projects/1",
    );
    assertEquals(intent.backlog, "github");
  }
});

Deno.test("parseArgs accepts --backlog-repo", () => {
  const intent = parseArgs([
    "init",
    "--here",
    "--backlog",
    "github",
    "--backlog-repo",
    "myorg/myrepo",
  ]);
  assertEquals(intent.kind, "init");
  if (intent.kind === "init") {
    assertEquals(intent.backlogRepo, "myorg/myrepo");
  }
});

Deno.test("parseArgs defaults backlogUrl and backlogRepo to null", () => {
  const intent = parseArgs(["init", "demo"]);
  if (intent.kind === "init") {
    assertEquals(intent.backlogUrl, null);
    assertEquals(intent.backlogRepo, null);
  }
});
