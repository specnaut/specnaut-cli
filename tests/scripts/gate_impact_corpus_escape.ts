import type { Case } from "./gate_impact_case.ts";
import { declaration } from "./gate_impact_fixture.ts";
import { adapterCase, malformed, out } from "./gate_impact_corpus_causes.ts";

// A string that holds a lone high surrogate, written as a JSON escape, does not decode. jq refuses
// the whole file at parse; System.Text.Json parses it and refuses the string only when it is read.
// Both twins must name the same widening, wherever in the file the string sits.

/** The escape as six ASCII bytes. The code point itself is never written to a fixture. */
const LONE_SURROGATE = "\\ud800";

const MARK = "%LONE%";
/** Every fixture text of this file, for the byte-wise check of the differential test. */
export const ESCAPED: string[] = [];

/** `json` with the escape where it holds the mark. */
const escaped = (json: string): string => {
  const text = json.replaceAll(MARK, LONE_SURROGATE);
  ESCAPED.push(text);
  return text;
};

/** The line the PowerShell reader writes: the decode failure, by its type, under the problem. */
const decodeFailure = (what: string) => `gate-impact: ${what} (InvalidOperationException: `;

const inDeclaration = (name: string, over: Record<string, unknown>): Case => ({
  ...malformed(
    `a lone surrogate escape in ${name}`,
    escaped(JSON.stringify(declaration(over))),
    "not-json",
  ),
  pwshStderr: decodeFailure("declaration not-json"),
});

const inSnapshot = (name: string, commit: string, owners: unknown): Case => ({
  ...adapterCase(
    `a lone surrogate escape in ${name}`,
    out(escaped(
      `{"schema":1,"commit":"${commit}","complete":true,"owners":${JSON.stringify(owners)}}`,
    )),
    "adapter-invalid-json: base",
  ),
  pwshStderr: decodeFailure("adapter output invalid-json"),
});

const COMMIT = "$SPECNAUT_IMPACT_COMMIT";

export const ESCAPES: Case[] = [
  inDeclaration("a check's gate name", { checks: [{ gate: `a${MARK}`, scoped: "b" }] }),
  inDeclaration("an adapter file", { adapter: { command: "a", files: [`a${MARK}`] } }),
  inDeclaration("a scoped tier", { scoped_tiers: [`fast${MARK}`] }),
  inSnapshot("the echoed commit", MARK, []),
  inSnapshot("an owner id", COMMIT, [{ id: `a${MARK}`, roots: [], depends_on: [] }]),
  inSnapshot("an owner root", COMMIT, [{ id: "a", roots: [`a${MARK}/`], depends_on: [] }]),
];
