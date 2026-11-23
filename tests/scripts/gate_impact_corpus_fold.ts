import { type Case, change, FULL_MARKS, scoped } from "./gate_impact_case.ts";
import { declaration, OWNERS } from "./gate_impact_fixture.ts";
import { NESTED, owner, spelled, unreadable } from "./gate_impact_corpus_checkout.ts";

// What another fold could read a path as. A path holding a code point above U+007F, or `~` and a
// digit, is never compared, and a declared path holding one is refused; a match found only by
// folding letter case widens, never narrows.

const INERT = declaration().inert as string[];
const FULL_ON = declaration().full_on as string[];

/** A declared path a fold or HFS+ could read as another is refused, so the run widens. */
export const refused = (name: string, over: Record<string, unknown>, problem: string): Case => ({
  name,
  repo: { declaration: JSON.stringify(declaration(over)) },
  build: change("apps/web/a.ts"),
  code: 0,
  scope: "full",
  fallback: `declaration-malformed: ${problem}`,
  marks: FULL_MARKS,
});

/** An adapter's root alike: the base's graph holds it, so the base's snapshot is refused. */
export const rootRefused = (name: string, root: string): Case => ({
  name,
  repo: { owners: [...OWNERS, owner("odd", root)] },
  build: change("apps/web/a.ts"),
  code: 0,
  scope: "full",
  fallback: "adapter-invalid-root: base",
  marks: FULL_MARKS,
});

export const FOLDING: Case[] = [
  // HFS+ ignores U+200C in a name, so it reads this one as `.gitattributes`.
  unreadable(
    "a dotfile name an ignorable code point precedes widens, as HFS+ reads it as .gitattributes",
    "apps/web/‌.gitattributes",
    "apps/web/???.gitattributes",
  ),
  // A name holding a code point above U+007F: a fold or normalisation could make it a declared one.
  {
    name: "a file name holding a non-ASCII letter widens, as a fold could make it a full_on file",
    repo: {
      declaration: JSON.stringify(declaration({ full_on: [...FULL_ON, "apps/web/schema.sql"] })),
    },
    build: change("apps/web/\u017fchema.sql"),
    code: 0,
    scope: "full",
    fallback: "path-unreadable: apps/web/??chema.sql",
    marks: FULL_MARKS,
  },
  {
    // git on macOS precomposes a path it is handed unless told not to; the tree keeps it as given.
    name: "a decomposed file name widens, as a normalisation could make it another",
    build: async (r) => {
      await r.git("config", "core.precomposeunicode", "false");
      await spelled("apps/web/cafe\u0301.sql")(r);
    },
    code: 0,
    scope: "full",
    fallback: "path-unreadable: apps/web/cafe??.sql",
    marks: FULL_MARKS,
  },
  refused("a full_on file holding a non-ASCII letter is refused", {
    full_on: [...FULL_ON, "db/caf\u00e9.sql"],
  }, "full_on"),
  refused("a full_on file holding ~ and a digit is refused", {
    full_on: [...FULL_ON, "db/SCHEMA~1.SQL"],
  }, "full_on"),
  refused("an inert folder holding U+FFFD is refused", {
    inert: [...INERT, "notes\ufffd/"],
  }, "inert"),
  rootRefused("an owner root holding a non-ASCII letter is refused", "apps/caf\u00e9/"),
  rootRefused("an owner root holding ~ and a digit is refused", "apps/WEB~1/"),
  unreadable(
    "a folder name holding a non-ASCII letter widens, as a fold could make it an owner's root",
    "apps/web/widgetſ/a.ts",
    "apps/web/widget??/a.ts",
  ),
  unreadable(
    "a folder name holding ~ and a digit widens, as an 8.3 short name could be an owner's root",
    "apps/web/WIDGET~1/a.ts",
    "apps/web/WIDGET~1/a.ts",
  ),
  {
    name: "a path only another ASCII case of an inert root names is not inert",
    repo: { declaration: JSON.stringify(declaration({ inert: [...INERT, "notes/"] })) },
    build: change("NOTES/a.md"),
    code: 0,
    scope: "full",
    fallback: "unowned: NOTES/a.md",
    marks: FULL_MARKS,
  },
  {
    name: "a path an owner holds exactly is not skipped by another ASCII case of an inert root",
    repo: {
      owners: [...OWNERS, owner("notes", "NOTES/")],
      declaration: JSON.stringify(declaration({ inert: [...INERT, "notes/"] })),
    },
    build: change("NOTES/a.md"),
    code: 0,
    scope: "owners notes",
    marks: scoped("notes"),
  },
  {
    name: "an owner a path meets only in another ASCII case is added to the one holding it exactly",
    repo: { owners: [...OWNERS, owner("upper", "apps/WEB/")] },
    build: spelled("apps/WEB/b.ts"),
    code: 0,
    scope: "owners upper web",
    marks: scoped("upper", "web"),
  },
  {
    // Only a folder root in the path's own case spans what lies below it.
    name: "a nested .gitattributes a folder root spans only in another ASCII case widens",
    repo: { owners: [...NESTED, owner("attrs", "apps/WEB/.gitattributes")] },
    build: spelled("apps/WEB/.gitattributes"),
    code: 0,
    scope: "full",
    fallback: "checkout-config: apps/WEB/.gitattributes",
    marks: FULL_MARKS,
  },
];
