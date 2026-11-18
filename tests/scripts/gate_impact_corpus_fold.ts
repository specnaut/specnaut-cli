import { type Case, change, FULL_MARKS, scoped } from "./gate_impact_case.ts";
import { declaration, OWNERS } from "./gate_impact_fixture.ts";
import { NESTED, owner, spelled, unreadable } from "./gate_impact_corpus_checkout.ts";

// What another fold could read a path as. A component a fold could make an owner's root, or a
// judged dotfile, is never compared; a match found only by folding letter case widens, never narrows.

const INERT = declaration().inert as string[];

export const FOLDING: Case[] = [
  // HFS+ ignores U+200C in a name, so it reads this one as `.gitattributes`.
  unreadable(
    "a dotfile name an ignorable code point precedes widens, as HFS+ reads it as .gitattributes",
    "apps/web/‌.gitattributes",
    "apps/web/???.gitattributes",
  ),
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
