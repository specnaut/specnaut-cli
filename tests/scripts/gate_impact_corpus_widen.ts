import { type Case, change, FULL_MARKS } from "./gate_impact_case.ts";
import { ADAPTER, declaration, GATES, SUITE, WEB_ONLY } from "./gate_impact_fixture.ts";

// What widens to the full tier, and the cause each must name.

export const WIDENING: Case[] = [
  {
    name: "an unowned path widens",
    build: change("stray/file.txt"),
    code: 0,
    scope: "full",
    fallback: "unowned: stray/file.txt",
    marks: FULL_MARKS,
  },
  {
    name: "a path that merely starts with an exact root is not owned by it",
    build: change("docs/guide.md.bak"),
    code: 0,
    scope: "full",
    fallback: "unowned: docs/guide.md.bak",
    marks: FULL_MARKS,
  },
  {
    name: "a rename out of every root widens",
    build: async (r) => {
      await r.git("mv", "apps/web/a.ts", "moved-out.ts");
      await r.commit();
    },
    code: 0,
    scope: "full",
    fallback: "unowned: moved-out.ts",
    marks: FULL_MARKS,
  },
  {
    name: "a newline in an unowned path cannot forge a report line",
    posixOnly: true,
    build: change("stray\nfallback: none"),
    code: 0,
    scope: "full",
    fallback: "unowned: stray?fallback: none",
    marks: FULL_MARKS,
  },
  {
    name: "a full_on file widens",
    build: change("locks/app.lock"),
    code: 0,
    scope: "full",
    fallback: "full-on: locks/app.lock",
    marks: FULL_MARKS,
  },
  {
    name: "a full_on directory widens",
    build: change("tools/build/step.sh"),
    code: 0,
    scope: "full",
    fallback: "full-on: tools/build/step.sh",
    marks: FULL_MARKS,
  },
  {
    name: "full_on beats inert",
    repo: {
      declaration: JSON.stringify(declaration({ full_on: ["locks/"], inert: ["locks/"] })),
    },
    build: change("locks/app.lock"),
    code: 0,
    scope: "full",
    fallback: "full-on: locks/app.lock",
    marks: FULL_MARKS,
  },
  {
    name: "a protected path beats inert",
    repo: {
      declaration: JSON.stringify(declaration({ inert: [".specnaut/", "tools/"] })),
    },
    build: async (r) => {
      await r.commit({ ".specnaut/gates.yml": `${GATES}# a note\n` });
    },
    code: 0,
    scope: "full",
    fallback: "protected-changed: .specnaut/gates.yml",
    marks: FULL_MARKS,
  },
  {
    name: "a tier outside scoped_tiers runs full",
    build: async (r) => {
      await r.commit({ "apps/web/a.ts": "changed\n" });
      return { args: ["full", "--base", r.main] };
    },
    code: 0,
    scope: "full",
    fallback: "tier-not-scoped: full",
    marks: ["suite unset"],
  },
  {
    name: "an added gitlink widens",
    build: async (r) => {
      await r.git("update-index", "--add", "--cacheinfo", `160000,${r.main},apps/web/vendored`);
      await r.git("commit", "-q", "-m", "gitlink");
      await Deno.mkdir(`${r.root}/apps/web/vendored`);
    },
    code: 0,
    scope: "full",
    fallback: "gitlink: apps/web/vendored",
    marks: FULL_MARKS,
  },
  {
    name: "a file changed into a symlink widens",
    posixOnly: true,
    build: async (r) => {
      await Deno.remove(`${r.root}/apps/web/a.ts`);
      await Deno.symlink("../api/a.ts", `${r.root}/apps/web/a.ts`);
      await r.commit();
    },
    code: 0,
    scope: "full",
    fallback: "type-change: apps/web/a.ts",
    marks: FULL_MARKS,
  },
  {
    name: "an added symlink widens",
    posixOnly: true,
    build: async (r) => {
      await Deno.symlink("a.ts", `${r.root}/apps/web/link.ts`);
      await r.commit();
    },
    code: 0,
    scope: "full",
    fallback: "symlink: apps/web/link.ts",
    marks: FULL_MARKS,
  },
  {
    name: "a declaration changed on the branch widens",
    build: async (r) => {
      await r.commit({ ".specnaut/impact.json": JSON.stringify(declaration({ inert: [] })) });
    },
    code: 0,
    scope: "full",
    fallback: "protected-changed: .specnaut/impact.json",
    marks: FULL_MARKS,
  },
  {
    name: "a declaration deleted on the branch is a change, not an opt-out",
    build: async (r) => {
      await r.commit({}, [".specnaut/impact.json"]);
    },
    code: 0,
    scope: "full",
    fallback: "protected-changed: .specnaut/impact.json",
    marks: FULL_MARKS,
  },
  {
    name: "a changed adapter file widens before any adapter runs",
    build: change(ADAPTER),
    code: 0,
    scope: "full",
    fallback: `protected-changed: ${ADAPTER}`,
    marks: FULL_MARKS,
  },
  {
    name: "a changed script under .specnaut/scripts widens",
    build: change(".specnaut/scripts/bash/a-new-helper.sh"),
    code: 0,
    scope: "full",
    fallback: "protected-changed: .specnaut/scripts/",
    marks: FULL_MARKS,
  },
  {
    name: "a narrow base cannot launder an earlier change to the declaration",
    build: async (r) => {
      const changed = await r.commit({
        ".specnaut/impact.json": JSON.stringify(declaration({ full_on: [] })),
      });
      await r.commit({ "apps/web/a.ts": "changed\n" });
      return { args: ["fast", "--base", changed] };
    },
    code: 0,
    scope: "full",
    fallback: "protected-changed: .specnaut/impact.json",
    marks: FULL_MARKS,
  },
  {
    name: "an empty --base widens",
    build: () => Promise.resolve({ args: ["fast", "--base", ""] }),
    code: 0,
    scope: "full",
    fallback: "base-empty",
    marks: FULL_MARKS,
  },
  {
    name: "a base that does not resolve widens",
    build: () => Promise.resolve({ args: ["fast", "--base", "no-such-revision"] }),
    code: 0,
    scope: "full",
    fallback: "base-unresolved: no-such-revision",
    marks: FULL_MARKS,
  },
  {
    name: "a zero remote sha widens",
    build: async (r) => {
      const tip = await r.commit({ "apps/web/a.ts": "changed\n" });
      return {
        args: ["fast", "--refs-stdin"],
        stdin: `refs/heads/feature ${tip} refs/heads/feature ${"0".repeat(40)}\n`,
      };
    },
    code: 0,
    scope: "full",
    fallback: "remote-zero: refs/heads/feature",
    marks: FULL_MARKS,
  },
  {
    name: "an unfetched remote sha widens",
    build: async (r) => {
      const tip = await r.commit({ "apps/web/a.ts": "changed\n" });
      return {
        args: ["fast", "--refs-stdin"],
        stdin: `refs/heads/feature ${tip} refs/heads/feature ${"a".repeat(40)}\n`,
      };
    },
    code: 0,
    scope: "full",
    fallback: `remote-unfetched: ${"a".repeat(40)}`,
    marks: FULL_MARKS,
  },
  {
    name: "a push line that is not hex widens",
    build: async (r) => {
      const tip = await r.commit({ "apps/web/a.ts": "changed\n" });
      return {
        args: ["fast", "--refs-stdin"],
        stdin: `refs/heads/feature ${tip} refs/heads/feature not-hex\n`,
      };
    },
    code: 0,
    scope: "full",
    fallback: "refs-malformed: refs/heads/feature",
    marks: FULL_MARKS,
  },
  {
    name: "a push of nothing but deleted refs widens",
    build: (r) =>
      Promise.resolve({
        args: ["fast", "--refs-stdin"],
        stdin: `(delete) ${"0".repeat(40)} refs/heads/gone ${r.main}\n`,
      }),
    code: 0,
    scope: "full",
    fallback: "no-base-in-refs",
    marks: FULL_MARKS,
  },
  {
    name: "a tier emptied on the branch is exit 4, naming what went",
    repo: { gates: `fast_gate:\n  - ${SUITE}\nfull_gate:\n  - ${SUITE}\n` },
    build: async (r) => {
      await r.commit({ ".specnaut/gates.yml": `fast_gate:\nfull_gate:\n  - ${SUITE}\n` });
    },
    code: 4,
    scope: "full",
    fallback: "protected-changed: .specnaut/gates.yml",
    marks: [],
    removed: [SUITE],
  },
  {
    name: "a command dropped from the tier runs the rest, and is reported",
    build: async (r) => {
      await r.commit({
        ".specnaut/gates.yml": GATES.replace(`  - ${WEB_ONLY}\n`, ""),
      });
    },
    code: 0,
    scope: "full",
    fallback: "protected-changed: .specnaut/gates.yml",
    marks: ["suite unset", "always unset"],
    removed: [WEB_ONLY],
  },
];
