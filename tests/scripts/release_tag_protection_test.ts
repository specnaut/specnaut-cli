import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/**
 * The release preflight's tag-protection gate (`scripts/release/require-tag-protection.sh`),
 * run against a stubbed `gh` that answers by URL and records every call. It passes only on an
 * active tag ruleset that holds the release tags against update and deletion, and fails closed
 * on anything it does not recognise. The actor ids below are made up.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SCRIPT = join(ROOT, "scripts/release/require-tag-protection.sh");
const PREFLIGHT = join(ROOT, ".specnaut/release/preflight.sh");

type Ruleset = Record<string, unknown>;
const GOOD: Ruleset = {
  id: 7,
  name: "tags",
  target: "tag",
  enforcement: "active",
  conditions: { ref_name: { include: ["refs/tags/v*"], exclude: [] } },
  rules: [{ type: "creation" }, { type: "update" }, { type: "deletion" }],
  bypass_actors: [{ actor_type: "RepositoryRole", actor_id: 99, bypass_mode: "always" }],
};

type World = { list?: Ruleset[] | "FAIL"; detail?: Ruleset | "FAIL"; immutable?: string | "FAIL" };

/** A `gh` on PATH that answers by URL from `world` and records each call in `<dir>/calls`. */
async function writeGhStub(dir: string, bin: string, world: World) {
  const list = world.list ?? [GOOD];
  const detail = world.detail ?? (Array.isArray(list) ? list[0] : GOOD);
  await Deno.writeTextFile(join(dir, "list.json"), JSON.stringify(list));
  await Deno.writeTextFile(join(dir, "detail.json"), JSON.stringify(detail));
  await Deno.writeTextFile(join(dir, "imm.json"), world.immutable ?? '{"enabled":false}');
  const fail = (k: keyof World) => world[k] === "FAIL" ? "exit 1" : ":";
  await Deno.writeTextFile(
    join(bin, "gh"),
    `#!/usr/bin/env bash
url=""; jq="."
while [ $# -gt 0 ]; do case "$1" in --jq) jq="$2"; shift ;; repos/*) url="$1" ;; esac; shift; done
echo "$url" >> '${dir}/calls'
case "$url" in
  */rulesets\\?*) ${fail("list")}; jq -r "$jq" '${dir}/list.json' ;;
  */rulesets/*) ${fail("detail")}; jq -r "$jq" '${dir}/detail.json' ;;
  */immutable-releases) ${fail("immutable")}; jq -r "$jq" '${dir}/imm.json' ;;
esac
`,
  );
  await Deno.chmod(join(bin, "gh"), 0o755);
}

async function run(world: World, script = `bash '${SCRIPT}'`) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-tag-gate-" });
  try {
    const bin = join(dir, "bin");
    await Deno.mkdir(bin);
    await writeGhStub(dir, bin, world);
    const out = await new Deno.Command("bash", {
      args: ["-c", script],
      env: {
        PATH: `${bin}${Deno.build.os === "windows" ? ";" : ":"}${Deno.env.get("PATH")}`,
        REPO: "o/r",
      },
    }).output();
    // No calls file when gh never ran (REPO unset); any other read error is a failure.
    const calls = await Deno.readTextFile(join(dir, "calls")).catch((e) => {
      if (e instanceof Deno.errors.NotFound) return "";
      throw e;
    });
    const text = new TextDecoder().decode(out.stdout) + new TextDecoder().decode(out.stderr);
    return { code: out.code, out: text, calls };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const with_ = (patch: Ruleset): Ruleset => ({ ...GOOD, ...patch });
const refs = (include: string[], exclude: string[] = []) =>
  with_({ conditions: { ref_name: { include, exclude } } });

Deno.test("a tag ruleset holding v* against update and deletion passes, and asks for tags", async () => {
  const r = await run({});
  assertEquals(r.code, 0, r.out);
  assertStringIncludes(r.out, '✓ release tags held by the ruleset "tags"');
  assertStringIncludes(r.out, "exempt actors: RepositoryRole:99:always");
  assertStringIncludes(r.out, "immutable releases: disabled");
  assertStringIncludes(r.calls, "rulesets?targets=tag&includes_parents=true");
  assertStringIncludes(r.calls, "rulesets/7?includes_parents=true");
});

Deno.test("no ruleset, a disabled one, or an unreadable list fails the release", async () => {
  for (
    const world of [{ list: [] }, { list: [with_({ enforcement: "disabled" })] }, {
      list: "FAIL" as const,
    }]
  ) {
    const r = await run(world);
    assertEquals(r.code, 1, `${JSON.stringify(world)}: ${r.out}`);
  }
});

Deno.test("a ruleset missing update or deletion, or not on tags, fails and says why", async () => {
  const cases: [Ruleset, string][] = [
    [with_({ rules: [{ type: "deletion" }] }), "no update rule"],
    [with_({ rules: [{ type: "update" }] }), "no deletion rule"],
    [with_({ target: "branch" }), "does not target tags"],
  ];
  for (const [rs, why] of cases) {
    const r = await run({ list: [rs] });
    assertEquals(r.code, 1, r.out);
    assertStringIncludes(r.out, why);
  }
});

Deno.test("includes and excludes are recognised narrowly: anything else fails closed", async () => {
  for (
    const ok of [refs(["refs/tags/*"]), refs(["~ALL"]), refs(["refs/tags/v*"], ["refs/tags/x"])]
  ) {
    assertEquals((await run({ list: [ok] })).code, 0, JSON.stringify(ok));
  }
  const bad: [Ruleset, string][] = [
    [refs(["refs/tags/v*.*.*"]), "no include covers"],
    [refs(["refs/tags/v*"], ["refs/tags/v9.*"]), "an exclude could remove"],
    [refs(["refs/tags/v*"], ["refs/tags/**"]), "an exclude could remove"],
    [refs(["refs/tags/v*"], ["refs/tags/v1.0.0"]), "an exclude could remove"],
    [refs(["refs/tags/v*"], ["~ALL"]), "an exclude could remove"],
    [refs(["refs/tags/v*"], ["v1.0.0"]), "an exclude could remove"],
    [refs(["refs/tags/v*"], ["refs/tags/V1.0.0"]), "an exclude could remove"],
  ];
  for (const [rs, why] of bad) {
    const r = await run({ list: [rs] });
    assertEquals(r.code, 1, r.out);
    assertStringIncludes(r.out, why);
  }
});

Deno.test("exempt actors read none only when the list is there and empty", async () => {
  const hidden = { ...GOOD };
  delete hidden.bypass_actors;
  assertStringIncludes((await run({ list: [hidden] })).out, "exempt actors: unknown");
  assertStringIncludes(
    (await run({ list: [with_({ bypass_actors: [] })] })).out,
    "exempt actors: none",
  );
});

Deno.test("immutable releases are printed, never judged", async () => {
  assertStringIncludes(
    (await run({ immutable: '{"enabled":true}' })).out,
    "immutable releases: enabled",
  );
  const unread = await run({ immutable: "FAIL" });
  assertEquals(unread.code, 0, unread.out);
  assertStringIncludes(unread.out, "immutable releases: unknown");
});

Deno.test("preflight's block fails the release on the gate's failure and survives a closed stdout", async () => {
  const src = (await Deno.readTextFile(PREFLIGHT)).replaceAll("\r\n", "\n");
  const m = src.match(/# BEGIN tag-protection-gate\n([\s\S]*?)# END tag-protection-gate/);
  assert(m, "preflight.sh has no tag-protection-gate block");
  const block = `set -euo pipefail\ntrap "" PIPE\nrepo=o/r\ncd '${ROOT}'\n${
    m[1]
  }\necho GATE-PASSED >&2`;
  const passed = await run({}, block);
  assertEquals(passed.code, 0, passed.out);
  assertStringIncludes(passed.calls, "rulesets?targets=tag");
  assertEquals((await run({ list: [] }, block)).code, 1);
  // stdout closed outright: every write to it fails, so only the `|| true` guard keeps the pass.
  const closed = await run({}, `exec >&-\n${block}`);
  assertEquals(closed.code, 0, closed.out);
  assertStringIncludes(closed.out, "GATE-PASSED");
});

Deno.test("an unreadable ruleset detail and an unset REPO fail the release", async () => {
  const detail = await run({ detail: "FAIL" });
  assertEquals(detail.code, 1, detail.out);
  assertStringIncludes(detail.out, "could not read tag ruleset 7");
  const unset = await run({}, `REPO= bash '${SCRIPT}'`);
  assertEquals(unset.code, 1, unset.out);
  assertStringIncludes(unset.out, "REPO is not set");
});
