import { type Case, change, FULL_MARKS, scoped } from "./gate_impact_case.ts";
import {
  declaration,
  type Owner,
  OWNERS,
  type Repo,
  SUITE,
  WEB_ONLY,
} from "./gate_impact_fixture.ts";

// What a change selects when nothing widens: the ground truth SC-002 holds the
// markers to, one case per edge the plan lists.

const withOwners = (owners: Owner[]) => async (r: Repo) => {
  await r.commit(r.graph(owners));
};
const dep = (id: string, depends_on: string[]) =>
  OWNERS.map((o) => (o.id === id ? { ...o, depends_on } : o));

export const SELECTION: Case[] = [
  {
    name: "a leaf's change runs that owner's scoped commands",
    build: change("apps/web/a.ts"),
    code: 0,
    scope: "owners web",
    marks: ["suite-scoped web", "web-scoped web", "always unset"],
  },
  {
    name: "a change reaches its reverse dependents, transitively",
    build: change("libs/core/a.ts"),
    code: 0,
    scope: "owners api core web",
    marks: ["suite-scoped api core web", "web-scoped web", "always unset"],
  },
  {
    name: "an exact-path root owns its file, and a check naming others is omitted",
    build: change("docs/guide.md"),
    code: 0,
    scope: "owners guide",
    marks: ["suite-scoped guide", "always unset"],
  },
  {
    name: "an addition under a root affects its owner",
    build: change("apps/api/new/file.ts"),
    code: 0,
    scope: "owners api web",
    marks: ["suite-scoped api web", "web-scoped web", "always unset"],
  },
  {
    name: "a deletion under a root affects its owner",
    build: async (r) => {
      await r.commit({}, ["apps/api/a.ts"]);
    },
    code: 0,
    scope: "owners api web",
    marks: ["suite-scoped api web", "web-scoped web", "always unset"],
  },
  {
    name: "a rename is its delete plus its add: both owners are affected",
    build: async (r) => {
      await r.git("mv", "apps/web/a.ts", "docs-moved.ts");
      await r.git("mv", "docs-moved.ts", "libs/core/moved.ts");
      await r.commit();
    },
    code: 0,
    scope: "owners api core web",
    marks: scoped("api", "core", "web"),
  },
  {
    name: "a dependency edge added on the branch affects its owner",
    build: withOwners(dep("guide", ["core"])),
    code: 0,
    scope: "owners guide",
    marks: ["suite-scoped guide", "always unset"],
  },
  {
    name: "a dependency edge removed on the branch still carries the change",
    build: async (r) => {
      await r.commit({ "libs/core/a.ts": "changed\n", ...r.graph(dep("api", [])) });
    },
    code: 0,
    scope: "owners api core web",
    marks: ["suite-scoped api core web", "web-scoped web", "always unset"],
  },
  {
    name: "an owner added on the branch is affected",
    build: withOwners([...OWNERS, { id: "extra", roots: ["apps/extra/"], depends_on: [] }]),
    code: 0,
    scope: "owners extra",
    marks: scoped("extra"),
  },
  {
    name: "an owner removed on the branch is affected, with its dependents",
    build: withOwners(
      OWNERS.filter((o) => o.id !== "api").map((o) =>
        o.id === "web" ? { ...o, depends_on: [] } : o
      ),
    ),
    code: 0,
    scope: "owners api web",
    marks: scoped("api", "web"),
  },
  {
    name: "a path under a root only the base knows still affects that owner",
    build: async (r) => {
      await r.commit({
        "apps/api/a.ts": "changed\n",
        ...r.graph(OWNERS.map((o) => o.id === "api" ? { ...o, roots: ["apps/elsewhere/"] } : o)),
      });
    },
    code: 0,
    scope: "owners api web",
    marks: scoped("api", "web"),
  },
  {
    name: "a path with spaces is matched as itself",
    build: change("apps/web/a file with spaces.ts"),
    code: 0,
    scope: "owners web",
    marks: scoped("web"),
  },
  {
    name: "a path with a newline is matched as itself",
    posixOnly: true,
    build: change("apps/web/a\nnewline.ts"),
    code: 0,
    scope: "owners web",
    marks: scoped("web"),
  },
  {
    name: "an inert path affects nothing: every mapped command is omitted",
    build: change(".specnaut/specs/001-x/plan.md"),
    code: 0,
    scope: "none",
    marks: ["always unset"],
  },
  {
    name: "an inert path inside an owner's root still affects nothing",
    repo: {
      declaration: JSON.stringify(declaration({ inert: [".graph/", "apps/web/notes/"] })),
    },
    build: change("apps/web/notes/draft.md"),
    code: 0,
    scope: "none",
    marks: ["always unset"],
  },
  {
    name: "the closure holds whatever order the adapter lists its owners in",
    repo: { owners: [...OWNERS].reverse() },
    build: change("libs/core/a.ts"),
    code: 0,
    scope: "owners api core web",
    marks: ["suite-scoped api core web", "web-scoped web", "always unset"],
  },
  {
    name: "the closure runs to its end, however long the chain",
    repo: {
      owners: [
        { id: "d", roots: ["apps/web/"], depends_on: ["c"] },
        { id: "c", roots: ["apps/api/"], depends_on: ["b"] },
        { id: "b", roots: ["docs/guide.md"], depends_on: ["a"] },
        { id: "a", roots: ["libs/core/"], depends_on: [] },
      ],
      declaration: JSON.stringify(declaration({ checks: [] })),
    },
    build: change("libs/core/a.ts"),
    code: 0,
    scope: "owners a b c d",
    marks: FULL_MARKS,
  },
  {
    name: "an owner holding two roots owns what is under either",
    repo: {
      owners: OWNERS.map((o) => o.id === "web" ? { ...o, roots: ["apps/web/", "apps/site/"] } : o),
    },
    build: change("apps/site/a.ts"),
    code: 0,
    scope: "owners web",
    marks: scoped("web"),
  },
  {
    name: "an owner holding two depends_on follows each of them",
    repo: { owners: dep("guide", ["core", "api"]) },
    build: change("apps/api/a.ts"),
    code: 0,
    scope: "owners api guide web",
    marks: scoped("api", "guide", "web"),
  },
  {
    name: "an empty diff omits every mapped command",
    build: async () => {},
    code: 0,
    scope: "none",
    marks: ["always unset"],
  },
  {
    name: "a gate command with no check runs as declared, with no owners",
    repo: { gates: `fast_gate:\n  - bash tools/mark.sh unmapped\n` },
    build: change("apps/web/a.ts"),
    code: 0,
    scope: "owners web",
    marks: ["unmapped unset"],
  },
  {
    name: "every command omitted is exit 4, never a pass",
    repo: { gates: `fast_gate:\n  - ${SUITE}\n  - ${WEB_ONLY}\n` },
    build: change(".specnaut/specs/001-x/plan.md"),
    code: 4,
    scope: "none",
    marks: [],
  },
  {
    name: "a push with several bases unions their changes",
    build: async (r) => {
      const one = await r.commit({ "apps/web/a.ts": "changed\n" });
      const two = await r.commit({ "docs/guide.md": "changed\n" });
      const lines = [one, r.main].map((base) => `refs/heads/feature ${two} refs/heads/x ${base}`);
      return { args: ["fast", "--refs-stdin"], stdin: lines.join("\n") + "\n" };
    },
    code: 0,
    scope: "owners guide web",
    marks: scoped("guide", "web"),
  },
  {
    name: "a push's bases each bring their own edges to the closure",
    build: async (r) => {
      const withEdge = await r.commit(r.graph(dep("guide", ["core"])));
      const tip = await r.commit({ "libs/core/a.ts": "changed\n", ...r.graph(OWNERS) });
      const lines = [withEdge, r.main].map((b) => `refs/heads/feature ${tip} refs/heads/x ${b}`);
      return { args: ["fast", "--refs-stdin"], stdin: lines.join("\n") + "\n" };
    },
    code: 0,
    scope: "owners api core guide web",
    marks: scoped("api", "core", "guide", "web"),
  },
  {
    name: "a deleted ref contributes nothing",
    build: async (r) => {
      const tip = await r.commit({ "apps/web/a.ts": "changed\n" });
      const zero = "0".repeat(40);
      const lines = [
        `(delete) ${zero} refs/heads/gone ${r.main}`,
        `refs/heads/feature ${tip} refs/heads/feature ${r.main}`,
      ];
      return { args: ["fast", "--refs-stdin"], stdin: lines.join("\n") + "\n" };
    },
    code: 0,
    scope: "owners web",
    marks: scoped("web"),
  },
];
