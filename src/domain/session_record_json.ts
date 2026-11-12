import type { LinkEnd } from "./checkout_link.ts";
import type { RecordedEntry, RecordedWalk } from "./checkout_trust.ts";
import { isFullSha } from "./commit_sha.ts";
import { isReflogMark, type ReflogMark } from "./head_reflog.ts";
import { isSessionId, type SessionRecord } from "./session_record.ts";

/**
 * The session record as a file, and the `SessionStart` hook's input. A record is read back only
 * whole: one field of the wrong shape and it is malformed, never read in part, so the check refuses
 * rather than judging what a record lacks.
 */

/** The record format; a record of another version is malformed. */
const VERSION = 3;

export type ParsedRecord =
  | { readonly kind: "parsed"; readonly record: SessionRecord }
  | { readonly kind: "malformed"; readonly why: string };

export function recordText(record: SessionRecord): string {
  const { head, reflog, tree } = record;
  return `${JSON.stringify({ version: VERSION, head, reflog, tree })}\n`;
}

export function parseRecord(text: string): ParsedRecord {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    // Not swallowed: the parser's message is the reason the check gives.
    return { kind: "malformed", why: `not JSON: ${err instanceof Error ? err.message : err}` };
  }
  if (isObject(value) && Number.isInteger(value.version) && value.version !== VERSION) {
    const why = `a version ${value.version} record, where this specnaut reads version ${VERSION}`;
    return { kind: "malformed", why: `${why}: start a new session` };
  }
  const record = recordOfJson(value);
  return record === null
    ? { kind: "malformed", why: `not a version ${VERSION} record` }
    : { kind: "parsed", record };
}

/** The session and the source a `SessionStart` hook's input names, or `null`. */
export type SessionStart = { readonly sessionId: string; readonly source: string };

export function sessionStartOf(payload: unknown): SessionStart | null {
  if (!isObject(payload) || !isString(payload.session_id) || !isString(payload.source)) return null;
  if (!isSessionId(payload.session_id)) return null;
  return { sessionId: payload.session_id, source: payload.source };
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";

function recordOfJson(v: unknown): SessionRecord | null {
  if (!isObject(v) || v.version !== VERSION || !isString(v.head) || !isFullSha(v.head)) return null;
  const reflog = reflogOf(v.reflog);
  if (reflog === null || !Array.isArray(v.tree)) return null;
  const tree = v.tree.map(walkOf);
  return tree.every((w) => w !== null)
    ? { head: v.head, reflog, tree: tree as RecordedWalk[] }
    : null;
}

function reflogOf(v: unknown): ReflogMark | null {
  return isObject(v) && isReflogMark(v) ? { bytes: v.bytes, sha256: v.sha256 } : null;
}

function walkOf(v: unknown): RecordedWalk | null {
  if (!isObject(v)) return null;
  if (v.kind === "blocked") {
    return isString(v.path) && isString(v.why)
      ? { kind: "blocked", path: v.path, why: v.why }
      : null;
  }
  if (v.kind !== "walked" || !Array.isArray(v.entries)) return null;
  const entries = v.entries.map(entryOf);
  return entries.every((e) => e !== null)
    ? { kind: "walked", entries: entries as RecordedEntry[] }
    : null;
}

function entryOf(v: unknown): RecordedEntry | null {
  if (!isObject(v) || !isString(v.path)) return null;
  const path = v.path;
  if (v.kind === "other") return { kind: "other", path };
  if (v.kind === "unreadable") {
    return isString(v.why) ? { kind: "unreadable", path, why: v.why } : null;
  }
  if (v.kind === "link") return linkOf(v, path);
  if (v.kind !== "file" || !isString(v.sha256) || !/^[0-9a-f]{64}$/.test(v.sha256)) return null;
  if (!Number.isInteger(v.links) || (v.links as number) < 1) return null;
  if (v.id !== undefined && v.id !== null && !isString(v.id)) return null;
  const id = v.id === undefined ? {} : { id: v.id as string | null };
  return { kind: "file", path, sha256: v.sha256, links: v.links as number, ...id };
}

function linkOf(v: Json, path: string): RecordedEntry | null {
  if (v.target !== undefined && !isString(v.target)) return null;
  const end = v.end === undefined ? undefined : endOf(v.end);
  if (end === null) return null;
  return {
    kind: "link",
    path,
    ...(v.target === undefined ? {} : { target: v.target }),
    ...(end === undefined ? {} : { end }),
  };
}

function endOf(v: unknown): LinkEnd | null {
  if (!isObject(v)) return null;
  if (v.kind === "outside") return { kind: "outside" };
  if (v.kind === "unresolved") return isString(v.why) ? { kind: "unresolved", why: v.why } : null;
  if (v.kind !== "inside" || !isString(v.path)) return null;
  if (v.id !== null && !isString(v.id)) return null;
  return { kind: "inside", path: v.path, id: v.id };
}
