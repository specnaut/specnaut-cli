import { type Case, FULL_MARKS } from "./gate_impact_case.ts";
import { declaration } from "./gate_impact_fixture.ts";
import { NESTED } from "./gate_impact_corpus_checkout.ts";
import { refused, rootRefused } from "./gate_impact_corpus_fold.ts";

// What Win32 could read a path as. It strips a trailing dot or space from a name and reads `:` as
// a stream separator, so `.gitattributes.` and `.gitattributes:x` open `.gitattributes`. A path
// with such a component is never compared, and a declared path holding one is refused: the graph
// does not lean on Git for Windows refusing these names (core.protectNTFS), a setting a clone may
// turn off.

const INERT = declaration().inert as string[];
const FULL_ON = declaration().full_on as string[];

/**
 * A changed name Win32 reads as another widens. Each one, compared as text, is a file `web` holds,
 * so a graph that compared it would narrow the run to `web`. A Windows checkout cannot hold it.
 */
const win32 = (name: string, path: string): Case => ({
  name,
  repo: { owners: NESTED },
  build: async (r) => {
    await r.commit({ [path]: "# changed\n" });
  },
  code: 0,
  scope: "full",
  fallback: `path-unreadable: ${path}`,
  marks: FULL_MARKS,
  posixOnly: true,
});

export const WIN32: Case[] = [
  win32(
    "a name ending in a dot widens, as Win32 reads it without the dot",
    "apps/web/.gitattributes.",
  ),
  win32("a name ending in a space widens, as Win32 reads it without the space", "apps/web/a.ts "),
  win32(
    "a name holding a colon widens, as Win32 reads it as a stream",
    "apps/web/.gitattributes:x",
  ),
  win32(
    "a folder name ending in a dot widens, as Win32 reads it without the dot",
    "apps/web./a.ts",
  ),
  rootRefused("an owner root whose folder ends in a space is refused", "apps/web /"),
  refused("a full_on file holding a colon is refused", {
    full_on: [...FULL_ON, "db/schema.sql:x"],
  }, "full_on"),
  refused("an inert name ending in a dot is refused", { inert: [...INERT, "notes."] }, "inert"),
];
