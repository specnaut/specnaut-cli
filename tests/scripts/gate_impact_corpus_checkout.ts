import { type Case, FULL_MARKS, scoped } from "./gate_impact_case.ts";
import { declaration, type Repo } from "./gate_impact_fixture.ts";

// A root file that changes how every other path is checked out or fetched widens the run,
// whatever the declaration calls it. `#` opens a comment in each of the three, so the change
// leaves every file one git can still read.

/** The names both graphs hold; gate_impact_graph_test.ts holds each twin to this list. */
export const CHECKOUT_CONFIG = [".gitattributes", ".lfsconfig", ".gitmodules"];

const edit = (path: string) => async (r: Repo) => {
  await r.commit({ [path]: "# changed\n" });
};

const declared = (over: Record<string, unknown>) => ({
  declaration: JSON.stringify(declaration(over)),
});

const widens = (name: string, path: string, over?: Record<string, unknown>): Case => ({
  name,
  repo: over ? declared(over) : undefined,
  build: edit(path),
  code: 0,
  scope: "full",
  fallback: `checkout-config: ${path}`,
  marks: FULL_MARKS,
});

const INERT = declaration().inert as string[];

export const CHECKOUT: Case[] = [
  ...CHECKOUT_CONFIG.flatMap((file) => [
    widens(`a change to the root ${file} widens, declared neither full_on nor inert`, file),
    widens(`a change to the root ${file} widens even declared inert`, file, {
      inert: [...INERT, file],
    }),
  ]),
  widens("a root .gitattributes declared full_on names why it always widens", ".gitattributes", {
    full_on: [".gitattributes"],
  }),
  // A case-insensitive file system hands git `.GitAttributes` when it opens `.gitattributes`.
  widens("a root .GitAttributes widens as the file it is read as", ".GitAttributes", {
    inert: [...INERT, ".GitAttributes"],
  }),
  {
    name: "a root name that only looks like .gitattributes is an ordinary path",
    build: edit(".gİtattributes"),
    code: 0,
    scope: "full",
    fallback: "unowned: .g??tattributes",
    marks: FULL_MARKS,
  },
  {
    name: "a nested .gitattributes no owner holds is unowned, not checkout config",
    build: edit("sub/.gitattributes"),
    code: 0,
    scope: "full",
    fallback: "unowned: sub/.gitattributes",
    marks: FULL_MARKS,
  },
  {
    name: "a nested .gitattributes inside an owner's root affects that owner only",
    build: edit("apps/web/.gitattributes"),
    code: 0,
    scope: "owners web",
    marks: scoped("web"),
  },
];
