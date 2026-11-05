import { type Case, change, FULL_MARKS } from "./gate_impact_case.ts";
import { declaration, OWNERS, type Repo } from "./gate_impact_fixture.ts";

// SC-003: every cause of FR-008, and every way a declaration can be malformed (FR-003,
// FR-009), runs the full tier and names itself. Each adapter here is invented, and each
// is `tools/bad.sh`, written per case by the test.

const malformed = (name: string, text: unknown, problem: string): Case => ({
  name: `a malformed declaration widens: ${name}`,
  repo: { declaration: typeof text === "string" ? text : JSON.stringify(text) },
  build: change("apps/web/a.ts"),
  code: 0,
  scope: "full",
  fallback: `declaration-malformed: ${problem}`,
  marks: FULL_MARKS,
});

const badPaths: [string, string][] = [
  ["a parent reference", "../x"],
  ["an absolute path", "/x"],
  ["a backslash", "a\\b"],
  ["a glob", "*.lock"],
  ["a control character", "a\tb"],
  ["a newline", "a\nb"],
  ["a leading dot segment", "./x"],
  ["a double slash", "a//b"],
  ["a lone dot", "."],
  ["a trailing parent reference", "a/.."],
];

const DECLARATIONS: Case[] = [
  malformed("not JSON", "{", "not-json"),
  malformed("trailing comma", '{"schema":1,}', "not-json"),
  malformed("not an object", "[]", "not-an-object"),
  malformed("two documents", '{"schema":1}{"schema":1}', "not-json"),
  malformed("the wrong schema", declaration({ schema: 2 }), "schema"),
  malformed("no adapter", declaration({ adapter: "x" }), "adapter.command"),
  malformed(
    "a newline in the adapter command",
    declaration({ adapter: { command: "a\nb", files: ["a"] } }),
    "adapter.command",
  ),
  malformed(
    "no adapter files",
    declaration({ adapter: { command: "a", files: [] } }),
    "adapter.files",
  ),
  malformed(
    "an adapter file outside the grammar",
    declaration({ adapter: { command: "a", files: ["../a"] } }),
    "adapter.files",
  ),
  malformed("scoped_tiers not a list", declaration({ scoped_tiers: "fast" }), "scoped_tiers"),
  malformed("an unknown scoped tier", declaration({ scoped_tiers: ["slow"] }), "scoped_tiers"),
  malformed("full_on missing", declaration({ full_on: undefined }), "full_on"),
  ...badPaths.map(([name, path]) =>
    malformed(`a full_on holding ${name}`, declaration({ full_on: [path] }), "full_on")
  ),
  malformed("inert outside the grammar", declaration({ inert: ["a*"] }), "inert"),
  malformed("checks not a list", declaration({ checks: {} }), "checks"),
  malformed(
    "a newline in a scoped command",
    declaration({ checks: [{ gate: "a", scoped: "a\nb" }] }),
    "checks",
  ),
  malformed(
    "a control character in a scoped command",
    declaration({ checks: [{ gate: "a", scoped: "a\u0007b" }] }),
    "checks",
  ),
  malformed(
    "an empty owners list",
    declaration({ checks: [{ gate: "a", scoped: "b", owners: [] }] }),
    "checks",
  ),
  malformed(
    "an owner outside the grammar",
    declaration({ checks: [{ gate: "a", scoped: "b", owners: ["no spaces"] }] }),
    "checks",
  ),
  malformed(
    "the same gate mapped twice",
    declaration({ checks: [{ gate: "a", scoped: "b" }, { gate: "a", scoped: "c" }] }),
    "checks.gate-duplicated",
  ),
  malformed(
    "a check naming an owner no snapshot holds",
    declaration({ checks: [{ gate: "a", scoped: "b", owners: ["nobody"] }] }),
    "unknown owner nobody",
  ),
];

const BAD_ADAPTER = "bash tools/bad.sh";
const SNAPSHOT = (over: string) =>
  `{"schema":1,"commit":"$SPECNAUT_IMPACT_COMMIT","complete":true,"owners":${
    JSON.stringify(OWNERS)
  }${over}}`;

/** A repository whose adapter is this script body, unchanged on the branch. */
const adapterCase = (name: string, body: string, cause: string): Case => ({
  name: `an adapter widens: ${name}`,
  repo: {
    declaration: JSON.stringify(declaration({
      adapter: { command: BAD_ADAPTER, files: ["tools/bad.sh"] },
    })),
    files: { "tools/bad.sh": `#!/usr/bin/env bash\n${body}\n` },
  },
  build: change("apps/web/a.ts"),
  code: 0,
  scope: "full",
  fallback: cause,
  marks: FULL_MARKS,
});

const out = (json: string) => `cat >"$SPECNAUT_IMPACT_OUT" <<JSON\n${json}\nJSON`;

const owners = (list: unknown) =>
  out(
    `{"schema":1,"commit":"$SPECNAUT_IMPACT_COMMIT","complete":true,"owners":${
      JSON.stringify(list)
    }}`,
  );

const ADAPTERS: Case[] = [
  adapterCase("a non-zero exit", "exit 3", "adapter-failed: base exit 3"),
  adapterCase(
    "a non-zero exit describing the candidate",
    `[ "$SPECNAUT_IMPACT_TREE" != "$SPECNAUT_IMPACT_REPO" ] || exit 5\n${out(SNAPSHOT(""))}`,
    "adapter-failed: candidate exit 5",
  ),
  adapterCase("no output", "exit 0", "adapter-no-output: base"),
  adapterCase("empty output", ': >"$SPECNAUT_IMPACT_OUT"', "adapter-no-output: base"),
  adapterCase("invalid JSON", out("{"), "adapter-invalid-json: base"),
  adapterCase(
    "the wrong schema",
    out(`{"schema":2,"commit":"$SPECNAUT_IMPACT_COMMIT","complete":true,"owners":[]}`),
    "adapter-schema-mismatch: base",
  ),
  adapterCase(
    "complete not true",
    out(`{"schema":1,"commit":"$SPECNAUT_IMPACT_COMMIT","complete":false,"owners":[]}`),
    "adapter-incomplete: base",
  ),
  adapterCase(
    "the wrong commit",
    out(`{"schema":1,"commit":"${"a".repeat(40)}","complete":true,"owners":[]}`),
    "adapter-commit-mismatch: base",
  ),
  adapterCase(
    "a dangling dependency",
    owners([{ id: "a", roots: ["a/"], depends_on: ["nobody"] }]),
    "adapter-dangling-depends-on: base",
  ),
  adapterCase(
    "an owner id outside the grammar",
    owners([{ id: "no spaces", roots: [], depends_on: [] }]),
    "adapter-invalid-owner: base",
  ),
  adapterCase(
    "an owner id with a newline",
    owners([{ id: "a\nb", roots: [], depends_on: [] }]),
    "adapter-invalid-owner: base",
  ),
  adapterCase(
    "an owner id ending in a newline",
    owners([{ id: "a\n", roots: [], depends_on: [] }]),
    "adapter-invalid-owner: base",
  ),
  adapterCase(
    "an owner id starting after a newline",
    owners([{ id: "\na", roots: [], depends_on: [] }]),
    "adapter-invalid-owner: base",
  ),
  adapterCase(
    "depends_on not a list",
    owners([{ id: "a", roots: [], depends_on: "a" }]),
    "adapter-invalid-owner: base",
  ),
  adapterCase(
    "an owner listed twice",
    owners([{ id: "a", roots: [], depends_on: [] }, { id: "a", roots: [], depends_on: [] }]),
    "adapter-invalid-owner: base",
  ),
  adapterCase(
    "a root outside the grammar",
    owners([{ id: "a", roots: ["../a/"], depends_on: [] }]),
    "adapter-invalid-root: base",
  ),
  adapterCase(
    "a root with a glob",
    owners([{ id: "a", roots: ["a*"], depends_on: [] }]),
    "adapter-invalid-root: base",
  ),
];

const WORKTREE: Case = {
  name: "a base worktree that cannot be made widens",
  build: async (r: Repo) => {
    await r.commit({ "apps/web/a.ts": "changed\n" });
    const dir = await r.git("rev-parse", "--git-common-dir");
    await Deno.writeTextFile(`${r.root}/${dir}/worktrees`, "not a directory\n");
  },
  code: 0,
  scope: "full",
  fallback: "worktree-failed: ",
  marks: FULL_MARKS,
};

export const CAUSES: Case[] = [...DECLARATIONS, ...ADAPTERS, WORKTREE];
