import { join } from "@std/path";
import { type Case, change, FULL_MARKS } from "./gate_impact_case.ts";
import { ADAPTER, declaration, OWNERS, SUITE, WEB_ONLY } from "./gate_impact_fixture.ts";

// FR-006, the ways the comparison with the default branch can go; FR-005, a path only one
// base's snapshot owns; and FR-009, paths compared byte for byte.

const ZWJ = "\u200d";

export const BASES: Case[] = [
  {
    name: "a default branch that cannot be named widens",
    // Git for Windows' installer writes init.defaultBranch into the system config, and the scripts
    // drop every GIT_* variable, GIT_CONFIG_NOSYSTEM included: there no config is ever without one.
    // The empty value below names none on every host.
    posixOnly: true,
    build: async (r) => {
      await change("apps/web/a.ts")(r);
      await r.git("config", "--unset", "init.defaultBranch");
    },
    code: 0,
    scope: "full",
    fallback: "default-branch-unresolved",
    marks: FULL_MARKS,
  },
  {
    name: "a default branch configured empty names none, and widens",
    build: async (r) => {
      await change("apps/web/a.ts")(r);
      await r.git("config", "init.defaultBranch", "");
    },
    code: 0,
    scope: "full",
    fallback: "default-branch-unresolved",
    marks: FULL_MARKS,
  },
  {
    name: "a default branch that does not exist widens",
    build: async (r) => {
      await change("apps/web/a.ts")(r);
      await r.git("config", "init.defaultBranch", "no-such-branch");
    },
    code: 0,
    scope: "full",
    fallback: "merge-base-unresolved: no-such-branch",
    marks: FULL_MARKS,
  },
  {
    name: "the merge-base is taken from the remote's default branch when there is one",
    build: async (r) => {
      await r.withOrigin();
      const changed = await r.commit({
        ".specnaut/impact.json": JSON.stringify(declaration({ full_on: [] })),
      });
      // A local main that has caught up would launder the change; the remote's has not.
      await r.git("update-ref", "refs/heads/main", changed);
      await r.commit({ "apps/web/a.ts": "changed\n" });
      return { args: ["fast", "--base", changed] };
    },
    code: 0,
    scope: "full",
    fallback: "protected-changed: .specnaut/impact.json",
    marks: FULL_MARKS,
  },
  {
    name: "a protected file changed into a symlink is not regular, whatever it was",
    posixOnly: true,
    build: async (r) => {
      await Deno.remove(join(r.root, ADAPTER));
      await Deno.symlink("mark.sh", join(r.root, ADAPTER));
      await r.commit();
    },
    code: 0,
    scope: "full",
    fallback: `protected-not-regular: ${ADAPTER}`,
    marks: FULL_MARKS,
  },
  {
    name: "a protected path reached through a symlink widens",
    posixOnly: true,
    repo: {
      declaration: JSON.stringify(declaration({
        adapter: { command: `bash ${ADAPTER}`, files: ["linked/impact-adapter.sh"] },
      })),
      files: { "real/impact-adapter.sh": "#!/usr/bin/env bash\n" },
    },
    build: async (r) => {
      await r.git("switch", "-q", "main");
      await Deno.symlink("real", `${r.root}/linked`);
      r.main = await r.commit();
      await r.git("switch", "-q", "-C", "feature");
    },
    code: 0,
    scope: "full",
    fallback: "protected-not-regular: linked/impact-adapter.sh",
    marks: FULL_MARKS,
  },
  {
    name: "a protected path that is itself a symlink widens",
    posixOnly: true,
    repo: {
      declaration: JSON.stringify(declaration({
        adapter: { command: `bash ${ADAPTER}`, files: ["tools/linked-adapter.sh"] },
      })),
    },
    build: async (r) => {
      await r.git("switch", "-q", "main");
      await Deno.symlink("impact-adapter.sh", `${r.root}/tools/linked-adapter.sh`);
      r.main = await r.commit();
      await r.git("switch", "-q", "-C", "feature");
    },
    code: 0,
    scope: "full",
    fallback: "protected-not-regular: tools/linked-adapter.sh",
    marks: FULL_MARKS,
  },
  {
    name: "a path only one of two bases' snapshots owns is unowned against the other",
    build: async (r) => {
      const knows = await r.commit(r.graph([
        ...OWNERS,
        { id: "stray", roots: ["stray/"], depends_on: [] },
      ]));
      const tip = await r.commit({ "stray/a.txt": "x\n", ...r.graph(OWNERS) });
      const lines = [knows, r.main].map((b) => `refs/heads/x ${tip} refs/heads/x ${b}`);
      return { args: ["fast", "--refs-stdin"], stdin: lines.join("\n") + "\n" };
    },
    code: 0,
    scope: "full",
    fallback: "unowned: stray/a.txt",
    marks: FULL_MARKS,
  },
  {
    name: "a non-ASCII unowned path widens, printed in ASCII byte by byte",
    build: change("stray/\u00e9t\u00e9.txt"),
    code: 0,
    scope: "full",
    fallback: "unowned: stray/??t??.txt",
    marks: FULL_MARKS,
  },
  {
    name: "a path differing from an exact root by a zero-width character is not that root",
    build: change(`docs/guide.md${ZWJ}`),
    code: 0,
    scope: "full",
    fallback: "unowned: docs/guide.md???",
    marks: FULL_MARKS,
  },
  {
    name: "two roots differing only by a zero-width character are two roots",
    repo: {
      owners: OWNERS.map((o) =>
        o.id === "web" ? { ...o, roots: ["apps/web/", `apps/web${ZWJ}/`] } : o
      ),
    },
    build: change(`apps/web${ZWJ}/a.ts`),
    code: 0,
    scope: "owners web",
    marks: ["suite-scoped web", "web-scoped web", "always unset"],
  },
  {
    name: "a root changed only by a zero-width character is a changed record",
    build: async (r) => {
      await r.commit({
        "docs/guide.md": "changed\n",
        ...r.graph(
          OWNERS.map((o) => o.id === "web" ? { ...o, roots: [`apps/web${ZWJ}/`] } : o),
        ),
      });
    },
    code: 0,
    scope: "owners guide web",
    marks: ["suite-scoped guide web", "web-scoped web", "always unset"],
  },
  {
    name: "a gate command differing from a check by a zero-width character is not that check",
    repo: {
      gates: `fast_gate:\n  - ${SUITE}${ZWJ}\n  - ${WEB_ONLY}\n`,
    },
    build: change("apps/web/a.ts"),
    code: 0,
    scope: "owners web",
    marks: [`suite${ZWJ} unset`, "web-scoped web"],
  },
];
