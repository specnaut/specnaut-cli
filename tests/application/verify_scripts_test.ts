import { assertEquals, assertStringIncludes } from "@std/assert";
import type { BaseFile, GitObjectReader } from "../../src/application/script_trust_ports.ts";
import { type VerifyOutcome, verifyScripts } from "../../src/application/verify_scripts.ts";
import { findHarness } from "../../src/cli/harnesses.ts";
import { BASE_LOCK, type BaseEntry, type TreeEntry } from "../../src/domain/script_trust.ts";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";

/**
 * The use case's failure branches, driven through fake ports: each way the base cannot be named is
 * `base_unknown` with its reason, and each way the lock at the base cannot be used is a reason on
 * the verdict, never a throw.
 */

const LOCK = "version: 2\nharness: claude\nbacklog_backend: local\nversion_scheme: semver\n" +
  "spec_backend: local\ntemplates_version: 0.0.1\nentries: {}\n";
const P = ".specnaut/scripts/custom.sh";
const enc = (s: string) => new TextEncoder().encode(s);
const TIP = "a".repeat(40);
const HEAD = "b".repeat(40);
const MB = "c".repeat(40);

type Repo = {
  originHead: string | null;
  globalDefault: string | null;
  hasOrigin: boolean;
  commits: Record<string, string>;
  mergeBase: string | null;
  ahead: number;
  lock: BaseFile;
  tip: BaseEntry[];
  prefix: string;
};

function reader(over: Partial<Repo>): GitObjectReader {
  const r: Repo = {
    originHead: "refs/remotes/origin/main",
    globalDefault: null,
    hasOrigin: true,
    commits: { "refs/remotes/origin/main": TIP, HEAD },
    mergeBase: MB,
    ahead: 0,
    lock: { kind: "blob", bytes: enc(LOCK) },
    tip: [{ kind: "blob", path: P, bytes: enc("x\n") }],
    prefix: "",
    ...over,
  };
  return {
    projectPrefix: r.prefix,
    originHead: () => Promise.resolve(r.originHead),
    globalDefaultBranch: () => Promise.resolve(r.globalDefault),
    hasOrigin: () => Promise.resolve(r.hasOrigin),
    commitOf: (ref) => Promise.resolve(r.commits[ref] ?? null),
    mergeBase: () => Promise.resolve(r.mergeBase),
    aheadCount: () => Promise.resolve(r.ahead),
    listTree: (commit) => Promise.resolve(commit === TIP ? r.tip : []),
    readFile: (_c, path) => Promise.resolve(path === BASE_LOCK ? r.lock : { kind: "absent" }),
    changedNames: () => Promise.resolve(["app/x.ts", "lib/y.ts"]),
  };
}

const tree: TreeEntry[] = [{ kind: "file", path: P, bytes: enc("x\n"), links: 1 }];

function run(over: Partial<Repo>, harness = findHarness): Promise<VerifyOutcome> {
  const walker = { walk: () => Promise.resolve({ kind: "walked" as const, entries: tree }) };
  return verifyScripts({ git: reader(over), walker, core: CORE_BUNDLE, findHarness: harness });
}

async function why(over: Partial<Repo>): Promise<string> {
  const out = await run(over);
  return out.kind === "base_unknown" ? out.why : `judged: ${out.verdict.trusted}`;
}

async function reasons(over: Partial<Repo>, harness = findHarness): Promise<string[]> {
  const out = await run(over, harness);
  if (out.kind !== "judged") throw new Error(`base unknown: ${out.why}`);
  return out.verdict.untrusted.map((u) => `${u.path} ${u.reason}`);
}

Deno.test("the base is unknown, with its reason, for each way it cannot be named", async () => {
  assertEquals(await why({ originHead: "refs/heads/main" }), "origin/HEAD names no plain branch");
  assertEquals(
    await why({ originHead: null, globalDefault: "--exec=x" }),
    "init.defaultBranch is not a plain branch name",
  );
  assertEquals(
    await why({ originHead: null }),
    "no origin/HEAD and no global init.defaultBranch",
  );
  assertEquals(await why({ commits: { HEAD } }), "refs/remotes/origin/main names no commit");
  assertEquals(
    await why({ commits: { "refs/remotes/origin/main": TIP } }),
    "HEAD names no commit",
  );
  assertEquals(
    await why({ mergeBase: null }),
    "HEAD shares no history with refs/remotes/origin/main",
  );
});

Deno.test("with no origin, the global default names the base, read at the local branch", async () => {
  const out = await run({
    originHead: null,
    globalDefault: "trunk",
    hasOrigin: false,
    commits: { "refs/heads/trunk": TIP, HEAD },
    ahead: 5,
  });
  assertEquals(out.kind === "judged" && [out.baseBranch, out.baseTip, out.base], [
    "trunk",
    TIP,
    MB,
  ]);
  assertEquals(out.kind === "judged" && out.verdict.untrusted, []);
});

Deno.test("a local base ahead of origin's copy is a reason; level with it is none", async () => {
  const commits = { "refs/remotes/origin/main": TIP, "refs/heads/main": HEAD, HEAD };
  assertEquals(await reasons({ commits, ahead: 2 }), [
    "refs/heads/main local main ahead of origin",
  ]);
  assertEquals(await reasons({ commits, ahead: 0 }), []);
});

Deno.test("each way the lock at the base cannot be used is a reason on the verdict", async () => {
  const at = (r: string[]) => r.filter((l) => l.startsWith(`${BASE_LOCK} at base: `));
  assertEquals(await reasons({ lock: { kind: "not_regular" } }), [
    `${BASE_LOCK} at base: is not a regular file`,
  ]);
  // A lock that parses but for one byte that is not UTF-8: refused, never read under a guess.
  const notUtf8 = Uint8Array.of(...enc(`${LOCK}# `), 0xff, 0x0a);
  assertEquals(at(await reasons({ lock: { kind: "blob", bytes: notUtf8 } })).length, 1);
  assertEquals(at(await reasons({ lock: { kind: "blob", bytes: enc("version: [\n") } })).length, 1);
  assertEquals(await reasons({}, () => null), [
    `${BASE_LOCK} at base: names a harness this binary does not know: claude`,
  ]);
});

Deno.test("no lock at the base: a script the base lacks is a first install", async () => {
  assertEquals(await reasons({ lock: { kind: "absent" }, tip: [] }), [
    `${P} first install: no base copy`,
  ]);
  const mapped = await reasons({ tip: [] });
  assertStringIncludes(mapped.join("\n"), `${P} not on base`);
});

Deno.test("the names are made relative to the project's folder", async () => {
  const out = await run({ prefix: "app/" });
  assertEquals(out.kind === "judged" && [out.names, out.namesRelativeTo], [
    ["x.ts", "../lib/y.ts"],
    "app",
  ]);
});
