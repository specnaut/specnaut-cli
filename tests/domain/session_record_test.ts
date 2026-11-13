import { assertEquals, assertStringIncludes } from "@std/assert";
import { CHECKOUT_REASON, type CheckoutWalk } from "../../src/domain/checkout_trust.ts";
import { type BaseEntry, REASON } from "../../src/domain/script_trust.ts";
import { sha256HexBytes } from "../../src/domain/sha256.ts";
import {
  isSessionId,
  judgeRecord,
  RECORDED_SOURCES,
  recordOf,
  SESSION_REASON,
  startReasons,
  tipDigests,
} from "../../src/domain/session_record.ts";
import { parseRecord, recordText, sessionStartOf } from "../../src/domain/session_record_json.ts";

/** The record a session start takes, and the rule that judges it against the base's tip. */

const enc = (s: string) => new TextEncoder().encode(s);
const S = ".claude/settings.json";
const L = ".claude/skills/x";
const HEAD = "c".repeat(40);
const OUTSIDE = "a".repeat(40);
/** HEAD's reflog at session start: its length and digest. */
const MARK = { bytes: 120, sha256: "e".repeat(64) };
const blob = (path: string, text: string): BaseEntry => ({ kind: "blob", path, bytes: enc(text) });
const TIP: BaseEntry[] = [blob(S, "{}\n"), { kind: "link", path: L, target: "../x" }];
/** Where the link leads: a root the check walks whole. */
const INSIDE = { kind: "inside", path: ".claude/x", id: null } as const;
const WALK: CheckoutWalk[] = [{
  kind: "walked",
  entries: [
    { kind: "file", path: S, bytes: enc("{}\n"), links: 1, id: "1:2" },
    { kind: "link", path: L, target: "../x", end: INSIDE },
  ],
}];

Deno.test("startup, resume and fork take the record; clear, compact and any other source never do", () => {
  for (const source of ["startup", "resume", "fork"]) {
    assertEquals(RECORDED_SOURCES.has(source), true);
  }
  for (const source of ["clear", "compact", "", "STARTUP", "other"]) {
    assertEquals(RECORDED_SOURCES.has(source), false, source);
  }
});

Deno.test("a session id is a file name and nothing that could name another folder", () => {
  assertEquals(isSessionId("3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f"), true);
  for (const id of ["", "..", "../x", "a/b", "a\\b", ".x", "-x", "a b", "a".repeat(129), "é"]) {
    assertEquals(isSessionId(id), false, id);
  }
});

Deno.test("the record holds HEAD and each file by the SHA-256 of its bytes, the rest as walked", async () => {
  const record = await recordOf(HEAD, MARK, [...WALK, {
    kind: "blocked",
    path: ".codex",
    why: "a link",
  }]);
  assertEquals(record, {
    head: HEAD,
    reflog: MARK,
    tree: [
      {
        kind: "walked",
        entries: [
          { kind: "file", path: S, sha256: await sha256HexBytes(enc("{}\n")), links: 1, id: "1:2" },
          { kind: "link", path: L, target: "../x", end: INSIDE },
        ],
      },
      { kind: "blocked", path: ".codex", why: "a link" },
    ],
  });
});

Deno.test("a record reads back as it was written", async () => {
  const record = await recordOf(HEAD, MARK, [
    {
      kind: "walked",
      entries: [
        ...(WALK[0].kind === "walked" ? WALK[0].entries : []),
        { kind: "file", path: "AGENTS.md", bytes: enc("x"), links: 2, id: null },
        {
          kind: "link",
          path: ".claude/a",
          target: "b",
          end: { kind: "inside", path: "b", id: null },
        },
        { kind: "link", path: ".claude/c", end: { kind: "unresolved", why: "gone" } },
        { kind: "other", path: ".claude/d" },
        { kind: "unreadable", path: ".claude/e", why: "denied" },
      ],
    },
    { kind: "blocked", path: ".codex", why: "a link" },
  ]);
  assertEquals(parseRecord(recordText(record)), { kind: "parsed", record });
});

Deno.test("a record that is not one of this version's is malformed, never read in part", () => {
  const ok = { version: 3, head: HEAD, reflog: MARK, tree: [] };
  const file = { kind: "file", path: S, sha256: "f".repeat(64), links: 1 };
  const cases: unknown[] = [
    null,
    [],
    { ...ok, version: 2 },
    { ...ok, head: "HEAD" },
    { ...ok, reflog: undefined },
    { ...ok, reflog: {} },
    { ...ok, reflog: { ...MARK, bytes: 0 } },
    { ...ok, reflog: { ...MARK, sha256: "HEAD" } },
    { ...ok, tree: {} },
    { ...ok, tree: [{ kind: "walked" }] },
    { ...ok, tree: [{ kind: "blocked", path: "x" }] },
    { ...ok, tree: [{ kind: "walked", entries: [{ ...file, sha256: "F".repeat(64) }] }] },
    { ...ok, tree: [{ kind: "walked", entries: [{ ...file, links: 0 }] }] },
    { ...ok, tree: [{ kind: "walked", entries: [{ ...file, id: 7 }] }] },
    { ...ok, tree: [{ kind: "walked", entries: [{ ...file, kind: "dir" }] }] },
    { ...ok, tree: [{ kind: "walked", entries: [{ kind: "link", path: L, end: { kind: "x" } }] }] },
    { ...ok, tree: [{ kind: "walked", entries: [{ kind: "unreadable", path: L }] }] },
  ];
  for (const value of cases) {
    assertEquals(parseRecord(JSON.stringify(value)).kind, "malformed", JSON.stringify(value));
  }
  assertEquals(parseRecord(JSON.stringify(ok)).kind, "parsed");
  const garbage = parseRecord("{not json");
  assertEquals(garbage.kind, "malformed");
  if (garbage.kind === "malformed") assertStringIncludes(garbage.why, "JSON");
});

Deno.test("a SessionStart payload names its session and its source", () => {
  const id = "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f";
  assertEquals(sessionStartOf({ session_id: id, source: "resume", cwd: "/x" }), {
    sessionId: id,
    source: "resume",
  });
  for (
    const bad of [null, "x", {}, { session_id: id }, { session_id: "../x", source: "startup" }]
  ) {
    assertEquals(sessionStartOf(bad), null, JSON.stringify(bad));
  }
});

async function judge(
  record: Awaited<ReturnType<typeof recordOf>>,
  headCommits: string[] = [],
  symlinks = true,
) {
  return judgeRecord({
    headCommits,
    untrustedCommits: [OUTSIDE],
    tree: record.tree,
    tip: TIP,
    tipDigests: await tipDigests(TIP, symlinks),
  });
}

Deno.test("a record of the tip holds", async () => {
  assertEquals(await judge(await recordOf(HEAD, MARK, WALK)), { holds: true, reasons: [] });
});

Deno.test("a record whose HEAD holds a commit the tip lacks fails, by rule 1", async () => {
  const verdict = await judge(await recordOf(HEAD, MARK, WALK), [OUTSIDE]);
  assertEquals(verdict.reasons, [{ path: OUTSIDE, reason: CHECKOUT_REASON.headHolds }]);
});

Deno.test("a recorded file whose digest is not the tip's fails, as differing", async () => {
  const walk: CheckoutWalk[] = [{
    kind: "walked",
    entries: [{ kind: "file", path: S, bytes: enc('{"hooks":{}}\n'), links: 1 }],
  }];
  const verdict = await judge(await recordOf(HEAD, MARK, walk));
  assertEquals(verdict.reasons, [
    { path: S, reason: REASON.differs },
    { path: L, reason: REASON.missing },
  ]);
});

Deno.test("a recorded file holding the tip's link target holds, as on disk where links are off", async () => {
  const walk: CheckoutWalk[] = [{
    kind: "walked",
    entries: [
      { kind: "file", path: S, bytes: enc("{}\n"), links: 1 },
      { kind: "file", path: L, bytes: enc("../x"), links: 1 },
    ],
  }];
  assertEquals((await judge(await recordOf(HEAD, MARK, walk), [], false)).holds, true);
});

Deno.test("where git writes links as links, a recorded file holding the tip's link target differs", async () => {
  const walk: CheckoutWalk[] = [{
    kind: "walked",
    entries: [
      { kind: "file", path: S, bytes: enc("{}\n"), links: 1 },
      { kind: "file", path: L, bytes: enc("../x"), links: 1 },
    ],
  }];
  const verdict = await judge(await recordOf(HEAD, MARK, walk), [], true);
  assertEquals(verdict.reasons, [{ path: L, reason: REASON.differs }]);
});

Deno.test("what the record found that the checkout now does not show is marked as found at session start", () => {
  const now = [{ path: S, reason: REASON.differs }];
  const atStart = [{ path: S, reason: REASON.differs }, { path: OUTSIDE, reason: "x" }];
  assertEquals(startReasons(now, atStart), [
    { path: OUTSIDE, reason: `${SESSION_REASON.atStart}: x` },
  ]);
});
