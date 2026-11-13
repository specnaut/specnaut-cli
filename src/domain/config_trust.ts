import { sameBytes } from "./bytes.ts";
import { REASON, withoutCr } from "./script_trust.ts";

/**
 * Whether the config inputs a branch can edit hold, in the work tree, what the base branch's tip
 * holds. The phases read these inputs from the work tree through their helper scripts; a phase
 * reads one only when its verdict here is trusted, so the value it reads is the tip's. One verdict
 * per input class, judged on the value its readers take, not on the whole file: grooming writes a
 * column into `backlog-config.yml`, and a merge marks `feature.json` partial, on the branch itself.
 *
 * Its limit is the script check's: it guards against mistakes (a branch that edits the config that
 * grades or lands it), not deliberate rewrites.
 */

/** The value a class is judged on: the file's raw bytes, or what its readers take from it. */
type Value = "bytes" | "tracker" | "linked_issue";

/** One config input a branch controls: its class, the file under the project's root, its value. */
export type ConfigInput = {
  readonly class: string;
  readonly path: string;
  readonly value: Value;
};

// deno-fmt-ignore
export const CONFIG_INPUTS: readonly ConfigInput[] = [
  { class: "workflow", path: ".specnaut/workflow.yml", value: "bytes" },
  { class: "size-limits", path: ".specnaut/size-limits.yml", value: "bytes" },
  { class: "boundaries", path: ".specnaut/boundaries.yml", value: "bytes" },
  { class: "backlog-config", path: ".specnaut/backlog-config.yml", value: "tracker" },
  { class: "linked-issue", path: ".specnaut/feature.json", value: "linked_issue" },
  { class: "gates", path: ".specnaut/gates.yml", value: "bytes" },
];

/** One path as the work tree holds it, or as a commit does. */
export type ConfigFile =
  | { readonly kind: "absent" }
  | { readonly kind: "file"; readonly bytes: Uint8Array }
  | { readonly kind: "refused"; readonly why: string };

export type ConfigSides = {
  readonly tree: ConfigFile;
  /** The base branch's tip: what trust is measured against. */
  readonly tip: ConfigFile;
  /** The merge base: read only to say the input is behind the base rather than edited. */
  readonly mergeBase: ConfigFile;
};

export type ConfigVerdict =
  | { readonly class: string; readonly path: string; readonly trusted: true }
  | {
    readonly class: string;
    readonly path: string;
    readonly trusted: false;
    readonly reason: string;
  };

/** The verdict of one input: trusted only when the tree's value is the tip's. */
export function judgeConfig(input: ConfigInput, sides: ConfigSides): ConfigVerdict {
  const reason = configReason(input, sides);
  const head = { class: input.class, path: input.path };
  return reason === null ? { ...head, trusted: true } : { ...head, trusted: false, reason };
}

function configReason(input: ConfigInput, sides: ConfigSides): string | null {
  const { tree, tip } = sides;
  if (tree.kind === "refused") return tree.why;
  if (tip.kind === "refused") return REASON.baseNotRegular;
  if (tree.kind === "absent") return tip.kind === "absent" ? null : REASON.missing;
  const mine = valueOf(input, tree.bytes);
  if (!(mine instanceof Uint8Array)) return mine.why;
  if (tip.kind === "absent") {
    return isBehind(input, mine, sides.mergeBase) ? REASON.behind : REASON.notOnBase;
  }
  const theirs = valueOf(input, tip.bytes);
  if (!(theirs instanceof Uint8Array)) return `at base: ${theirs.why}`;
  if (sameBytes(mine, theirs)) return null;
  if (sameBytes(withoutCr(mine), withoutCr(theirs))) return REASON.lineEndings;
  return isBehind(input, mine, sides.mergeBase) ? REASON.behind : REASON.differs;
}

/** The tree's value is the merge base's: only the base moved since the branch left it. */
function isBehind(input: ConfigInput, mine: Uint8Array, mergeBase: ConfigFile) {
  if (mergeBase.kind !== "file") return false;
  const theirs = valueOf(input, mergeBase.bytes);
  return theirs instanceof Uint8Array && sameBytes(mine, theirs);
}

type Refusal = { readonly why: string };

/** The keys grooming writes into `backlog-config.yml` on any branch: the only lines not judged. */
const GROOMING_KEYS = /^(intake_column|ready_column):/;
/**
 * A grooming line exactly as `groom-columns.sh` writes it: one double-quoted value, nothing a
 * YAML parser could read past. Anything else could break the parse of the whole file (and with it
 * remote mode) while the line itself goes unjudged, so it is refused. A CRLF ending is a line
 * ending, not part of the value: the rest of the file is judged for it.
 */
const GROOMING_LINE = /^(?:intake_column|ready_column): "[^"\\\r]*"[ \t]*\r?$/;

/**
 * What a class's readers take from the file, as bytes to compare, or why it cannot be read.
 * `tracker`: every line but the ones grooming writes, so a key added later (a backend's address, a
 * `remote:` block) is judged without anyone listing it. `linked_issue`: its token, as written.
 */
function valueOf(input: ConfigInput, bytes: Uint8Array): Uint8Array | Refusal {
  if (input.value === "bytes") return bytes;
  const text = new TextDecoder().decode(bytes);
  return input.value === "linked_issue" ? linkOf(text) : trackerOf(text);
}

/** Every line of `backlog-config.yml` but the grooming lines, each checked to hold its shape. */
function trackerOf(text: string): Uint8Array | Refusal {
  if (/\r(?!\n)/.test(text)) return { why: "a carriage return inside a line" };
  const lines = text.split("\n");
  const groomed = lines.filter((line) => GROOMING_KEYS.test(line));
  const odd = groomed.find((line) => !GROOMING_LINE.test(line));
  if (odd !== undefined) return { why: `${odd.split(":")[0]} is not one quoted value` };
  const keys = groomed.map((line) => line.split(":")[0]);
  if (new Set(keys).size < keys.length) return { why: "a column key is given twice" };
  const kept = lines.filter((line) => !GROOMING_KEYS.test(line));
  return new TextEncoder().encode(kept.join("\n"));
}

/** A key literal in JSON text, as written, with what follows it up to its colon. */
const JSON_KEY = /"((?:[^"\\]|\\.)*)"\s*:/g;
/** The key as the sed readers match it: anywhere in the text, an escaped key's tail included. */
const RAW_KEY = /"linked_issue"/g;
/** What they take after it, on its line: the colon, then a token up to a comma, brace or space. */
const RAW_VALUE = /"linked_issue"[ \t\v\f\r]*:[ \t\v\f\r]*([^,} \t\n\v\f\r]*)/;
/** The only tokens every reader takes alike: no link, or an issue number as written. */
const TOKEN = /^(?:null|[1-9][0-9]*)$/;

/**
 * `feature.json`'s `linked_issue`: the token its line-wise sed readers take, compared as written,
 * never as a parsed number (`1e1` is not `10`: a digit-only sed reads `1`). A file its readers
 * could read two ways, sed or jq (the last key, escapes decoded), is refused, never compared.
 */
function linkOf(text: string): Uint8Array | Refusal {
  const keys = [...text.matchAll(JSON_KEY)].filter((m) => decodedKey(m[1]) === "linked_issue");
  if (keys.some((m) => m[1] !== "linked_issue")) return { why: "linked_issue is written escaped" };
  const raw = [...text.matchAll(RAW_KEY)].length;
  if (raw > 1) return { why: "linked_issue is given twice" };
  const token = raw === 0 ? "" : RAW_VALUE.exec(text)?.[1] ?? "";
  if (raw === 1 && !TOKEN.test(token)) return { why: "linked_issue is not null or a number" };
  const parsed = parseJson(text);
  if ("why" in parsed) return parsed;
  if (token !== jqLink(parsed.value)) {
    return { why: "linked_issue is not read the same way by its readers" };
  }
  return new TextEncoder().encode(token);
}

/** The text parsed as JSON, or why it does not parse. */
function parseJson(text: string): { readonly value: unknown } | Refusal {
  try {
    return { value: JSON.parse(text) };
  } catch (err) {
    // Not swallowed: the parse failure is the reason the verdict reports.
    return { why: `does not parse: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** The top-level link as jq's `.linked_issue` reads it, written back as JSON; none is "". */
function jqLink(parsed: unknown): string {
  const top = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  if (!top || !("linked_issue" in parsed)) return "";
  return JSON.stringify((parsed as Record<string, unknown>).linked_issue);
}

/** A key literal's text with its escapes decoded: `\uXXXX` to its character, `\x` to `x`. */
function decodedKey(raw: string): string {
  return raw.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\(.)/g, "$1");
}
