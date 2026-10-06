import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  formatCost,
  ordered,
  thresholdsFrom,
  toneOf,
  untilReset,
  type Window,
} from "../../mods/specnaut-cockpit/hooks/core/usage.ts";
import { alertsFor } from "../../mods/specnaut-cockpit/hooks/core/alerts.ts";
import {
  advance,
  chainLine,
  chainShort,
  IDLE,
  phaseOf,
  phaseOfPrompt,
  promptSubmitted,
  turnEnded,
} from "../../mods/specnaut-cockpit/hooks/core/chain.ts";
import { holdFor, lift } from "../../mods/specnaut-cockpit/hooks/core/hold.ts";
import { bandSegments, width } from "../../mods/specnaut-cockpit/hooks/core/band.ts";
import {
  asHistory,
  costDelta,
  emptyHistory,
  lastDays,
  localDay,
  prune,
  record,
  topBranches,
} from "../../mods/specnaut-cockpit/hooks/core/history.ts";
import { paneRows } from "../../mods/specnaut-cockpit/hooks/core/pane.ts";

/**
 * The cockpit mod's logic (#635), kept pure so it runs here under `deno test`;
 * the hooks module that wires it to Claude Code is covered by
 * `mods/specnaut-cockpit/tests/*.test.ts` under `claude plugin test`.
 */

const NOW = Date.parse("2026-10-06T12:00:00Z");
const inMin = (m: number) => new Date(NOW + m * 60_000).toISOString();
const T = { warnAt: 80, holdAt: 90 };
const w = (kind: string, percentUsed: number, resetsAt?: string): Window => ({
  kind,
  percentUsed,
  resetsAt,
});

// ── usage ────────────────────────────────────────────────────────────────

Deno.test("untilReset reads as minutes, hours and days", () => {
  assertEquals(untilReset(inMin(45), NOW), "45m");
  assertEquals(untilReset(inMin(130), NOW), "2h10");
  assertEquals(untilReset(inMin(120), NOW), "2h");
  assertEquals(untilReset(inMin(76 * 60), NOW), "3d4h");
  assertEquals(untilReset(inMin(-5), NOW), "<1m");
  assertEquals(untilReset(undefined, NOW), undefined);
  assertEquals(untilReset("not a date", NOW), undefined);
});

Deno.test("tone: alert only while the hold is on", () => {
  assertEquals(toneOf(79, T), "normal");
  assertEquals(toneOf(80, T), "warn");
  assertEquals(toneOf(90, T), "alert");
  assertEquals(toneOf(95, { warnAt: 80, holdAt: 100 }), "warn");
});

Deno.test("windows are ordered 5h, 7d, spend, then the rest", () => {
  const out = ordered([w("zeta", 1), w("seven_day", 1), w("spend_limit", 1), w("five_hour", 1)]);
  assertEquals(out.map((x) => x.kind), ["five_hour", "seven_day", "spend_limit", "zeta"]);
});

Deno.test("cost keeps cents until it is large", () => {
  assertEquals(formatCost(0.04), "$0.04");
  assertEquals(formatCost(3.125), "$3.13");
  assertEquals(formatCost(124.4), "$124");
  assertEquals(formatCost(Number.NaN), "$0");
});

// ── alerts ───────────────────────────────────────────────────────────────

Deno.test("a window toasts once per threshold, not once per measurement", () => {
  const reset = inMin(100);
  let memo = {};
  const at = (p: number) => {
    const r = alertsFor([w("five_hour", p, reset)], memo, [80, 90], NOW);
    memo = r.memo;
    return r.toasts;
  };
  assertEquals(at(70), []);
  assertEquals(at(81), ["5-hour usage window at 81% — resets in 1h40"]);
  assertEquals(at(84), []);
  assertEquals(at(91).length, 1);
  assertEquals(at(97), []);
});

Deno.test("a new window (new reset) starts the announcements over", () => {
  let r = alertsFor([w("five_hour", 85, inMin(10))], {}, [80, 90], NOW);
  assertEquals(r.toasts.length, 1);
  r = alertsFor([w("five_hour", 85, inMin(310))], r.memo, [80, 90], NOW);
  assertEquals(r.toasts.length, 1, "a fresh window that is already at 85% is news");
});

Deno.test("jumping past both thresholds announces the higher one only", () => {
  const r = alertsFor([w("seven_day", 93)], {}, [80, 90], NOW);
  assertEquals(r.toasts, ["weekly usage window at 93%"]);
});

// ── chain ────────────────────────────────────────────────────────────────

Deno.test("a specnaut Skill call names its phase, flags and plugin scope aside", () => {
  assertEquals(phaseOf("specnaut", "implement"), "implement");
  assertEquals(phaseOf("specnaut", "--manual merge --no-close"), "merge");
  assertEquals(phaseOf("specnaut-plugin:specnaut", "review"), "review");
  assertEquals(phaseOf("specnaut", "audit security"), null);
  assertEquals(phaseOf("specnaut", ""), null);
  assertEquals(phaseOf("board", "merge"), null);
  assertEquals(phaseOf("not-specnaut", "merge"), null);
  assertEquals(
    phaseOf("someone-else:specnaut", "merge"),
    null,
    "another plugin's skill of that name",
  );
});

Deno.test("a typed /specnaut prompt names its phase", () => {
  assertEquals(phaseOfPrompt('/specnaut plan "Add OAuth2 login"'), "plan");
  assertEquals(phaseOfPrompt("/specnaut-plugin:specnaut merge"), "merge");
  assertEquals(phaseOfPrompt("/specnaut"), null);
  assertEquals(phaseOfPrompt("please run /specnaut plan"), null);
  assertEquals(phaseOfPrompt("/specnautx plan"), null);
  assertEquals(phaseOfPrompt("/someone-else:specnaut merge"), null);
});

Deno.test("the chain line marks done, current and pending phases", () => {
  const s = advance(IDLE, "implement");
  assertEquals(chainLine(s), "plan ✓ tasks ✓ implement ● review ○ merge ○");
  assertEquals(chainShort(s), "implement 3/5");
  assertEquals(chainLine(IDLE), "");
});

Deno.test("the turn that ran merge finishes the chain; the next plain prompt clears it", () => {
  let s = turnEnded(advance(IDLE, "merge"));
  assert(s.finished);
  assertEquals(chainLine(s), "plan ✓ tasks ✓ implement ✓ review ✓ merge ✓");
  assertEquals(chainShort(s), "merged ✓");
  s = promptSubmitted(s, null);
  assertEquals(s, IDLE);
});

Deno.test("a turn that ends mid-chain keeps the chain in view", () => {
  const s = advance(IDLE, "review");
  assertEquals(turnEnded(s), s);
  assertEquals(promptSubmitted(s, null), s);
});

// ── hold ─────────────────────────────────────────────────────────────────

Deno.test("the hold refuses a guarded phase when a window is at the threshold", () => {
  const h = holdFor("merge", [w("five_hour", 93, inMin(65))], 90, {}, NOW);
  assert(h);
  assertEquals(h.window.kind, "five_hour");
  assertStringIncludes(h.reason, "quota hold before `merge`");
  assertStringIncludes(h.reason, "5-hour usage window is at 93% and resets in 1h05");
  assertStringIncludes(h.reason, "`/specnaut merge` resumes it");
  assertStringIncludes(h.reason, "Do not run the phase's steps by any other means");
});

Deno.test("the hold leaves unguarded phases, room below the threshold, and holdAt 100 alone", () => {
  assertEquals(holdFor("tasks", [w("five_hour", 99)], 90, {}, NOW), null);
  assertEquals(holdFor("plan", [w("five_hour", 99)], 90, {}, NOW), null);
  assertEquals(holdFor("merge", [w("five_hour", 89.9)], 90, {}, NOW), null);
  assert(holdFor("merge", [w("five_hour", 90)], 90, {}, NOW), "at the threshold is held");
  assertEquals(holdFor("merge", [w("five_hour", 100)], 100, {}, NOW), null);
});

Deno.test("a lifted hold stays lifted for that window, and returns with the next", () => {
  const first = holdFor("implement", [w("seven_day", 95, "R1")], 90, {}, NOW);
  assert(first);
  const lifted = lift({}, [first.window]);
  assertEquals(holdFor("review", [w("seven_day", 96, "R1")], 90, lifted, NOW), null);
  assert(
    holdFor("review", [w("seven_day", 96, "R2")], 90, lifted, NOW),
    "a new window holds again",
  );
  assert(
    holdFor("review", [w("seven_day", 96, "R1"), w("five_hour", 92, "S1")], 90, lifted, NOW),
    "lifting one window does not lift another",
  );
});

Deno.test("a reading taken before its window reset does not hold the new window", () => {
  assertEquals(holdFor("merge", [w("five_hour", 99, inMin(-1))], 90, {}, NOW), null);
  assert(holdFor("merge", [w("five_hour", 99, inMin(1))], 90, {}, NOW));
  assert(holdFor("merge", [w("seven_day", 99)], 90, {}, NOW), "no reset time: still held");
});

Deno.test("thresholds come from the options, held to the declared bounds", () => {
  assertEquals(thresholdsFrom(undefined), { warnAt: 80, holdAt: 90 });
  assertEquals(thresholdsFrom({ hold_at: 75, warn_at: 60 }), { warnAt: 60, holdAt: 75 });
  assertEquals(thresholdsFrom({ hold_at: 5, warn_at: 500 }), { warnAt: 100, holdAt: 50 });
  assertEquals(thresholdsFrom({ hold_at: "90", warn_at: Number.NaN }), { warnAt: 80, holdAt: 90 });
});

// ── band ─────────────────────────────────────────────────────────────────

const READING = {
  windows: [w("seven_day", 31, inMin(76 * 60)), w("five_hour", 82, inMin(130))],
  contextPercent: 48,
  costUsd: 3.12,
};

Deno.test("the band shows everything when it fits", () => {
  const s = bandSegments(READING, advance(IDLE, "implement"), T, 200, NOW);
  const text = s.map((x) => x.text).join("");
  assertEquals(
    text,
    "5h 82% ↻2h10 · 7d 31% ↻3d4h · ctx 48% · $3.12 · ▸ plan ✓ tasks ✓ implement ● review ○ merge ○",
  );
  assertEquals(s.find((x) => x.text === "82%")?.tone, "warn");
});

Deno.test("a narrow band drops detail before it drops a limit", () => {
  const chain = advance(IDLE, "implement");
  for (const cols of [90, 60, 40, 30]) {
    const s = bandSegments(READING, chain, T, cols, NOW);
    assert(width(s) <= cols, `${cols} columns: ${s.map((x) => x.text).join("")}`);
    const text = s.map((x) => x.text).join("");
    assertStringIncludes(text, "5h 82%");
    assertStringIncludes(text, "7d 31%");
  }
});

Deno.test("nothing measured and no chain: the band is empty", () => {
  assertEquals(bandSegments(null, IDLE, T, 120, NOW), []);
  assertEquals(bandSegments({ windows: [] }, IDLE, T, 120, NOW), []);
});

Deno.test("no rate limits (an API key): context, cost and chain still show", () => {
  const s = bandSegments({ windows: [], contextPercent: 12, costUsd: 0.5 }, IDLE, T, 120, NOW);
  assertEquals(s.map((x) => x.text).join(""), "ctx 12% · $0.50");
});

// ── history ──────────────────────────────────────────────────────────────

Deno.test("localDay applies the UTC offset", () => {
  const lateUtc = Date.parse("2026-10-06T23:30:00Z");
  assertEquals(localDay(lateUtc, 0), "2026-10-06");
  assertEquals(localDay(lateUtc, 120), "2026-10-07");
  assertEquals(localDay(Date.parse("2026-10-06T01:00:00Z"), -300), "2026-10-05");
});

Deno.test("record adds cost to the day and the branch, and keeps each window's peak", () => {
  const branch = { key: "/w/app#main", label: "app · main" };
  let h = record(emptyHistory(), {
    day: "2026-10-06",
    costDelta: 1.5,
    windows: [w("five_hour", 40)],
    branch,
  });
  h = record(h, { day: "2026-10-06", costDelta: 0.5, windows: [w("five_hour", 70)], branch });
  h = record(h, { day: "2026-10-06", costDelta: 0, windows: [w("five_hour", 55)], branch });
  assertEquals(h.days["2026-10-06"], { costUsd: 2, peak: { five_hour: 70 } });
  assertEquals(h.branches["/w/app#main"], {
    label: "app · main",
    costUsd: 2,
    lastDay: "2026-10-06",
  });
});

Deno.test("costDelta counts growth, and a ledger that started over counts whole", () => {
  assertEquals(costDelta(2, 3.5), 1.5);
  assertEquals(costDelta(3.5, 3.5), 0);
  assertEquals(costDelta(3.5, 0.25), 0.25, "/clear restarts the session's cost");
  assertEquals(costDelta(1, undefined), 0);
  assertEquals(costDelta(1, Number.POSITIVE_INFINITY), 0);
});

Deno.test("a negative or non-finite delta is never recorded as cost", () => {
  let h = record(emptyHistory(), { day: "2026-10-06", costDelta: -3, windows: [] });
  h = record(h, { day: "2026-10-06", costDelta: Number.NaN, windows: [] });
  assertEquals(h.days["2026-10-06"].costUsd, 0);
});

Deno.test("prune keeps exactly the retention window", () => {
  let h = emptyHistory();
  for (const day of ["2026-07-08", "2026-07-09", "2026-10-06"]) {
    h = record(h, { day, costDelta: 1, windows: [], branch: { key: day, label: day } });
  }
  const p = prune(h, "2026-10-06", 90);
  assertEquals(Object.keys(p.days).sort(), ["2026-07-09", "2026-10-06"]);
  assertEquals(Object.keys(p.branches).sort(), ["2026-07-09", "2026-10-06"]);
});

Deno.test("lastDays fills empty days; topBranches ranks by cost within the window", () => {
  let h = record(emptyHistory(), {
    day: "2026-10-04",
    costDelta: 2,
    windows: [],
    branch: { key: "a", label: "A" },
  });
  h = record(h, { day: "2026-10-06", costDelta: 5, windows: [], branch: { key: "b", label: "B" } });
  h = record(h, {
    day: "2026-09-01",
    costDelta: 50,
    windows: [],
    branch: { key: "old", label: "Old" },
  });
  const days = lastDays(h, "2026-10-06");
  assertEquals(days.length, 7);
  assertEquals(days[0].day, "2026-09-30");
  assertEquals(days.map((d) => d.costUsd), [0, 0, 0, 0, 2, 0, 5]);
  assertEquals(topBranches(h, "2026-10-06").map((b) => b.label), ["B", "A"]);
});

Deno.test("anything stored that is not a History reads as an empty one", () => {
  assertEquals(asHistory(undefined), emptyHistory());
  assertEquals(asHistory({ v: 2 }), emptyHistory());
  assertEquals(asHistory("x"), emptyHistory());
});

// ── pane ─────────────────────────────────────────────────────────────────

Deno.test("the pane lists limits, the session, seven days and the branches", () => {
  const h = record(emptyHistory(), {
    day: "2026-10-06",
    costDelta: 3,
    windows: [w("five_hour", 82)],
    branch: { key: "k", label: "app · feat/x" },
  });
  const text = paneRows({
    reading: READING,
    chain: advance(IDLE, "review"),
    history: h,
    today: "2026-10-06",
    thresholds: T,
    now: NOW,
  }).map((r) => r.map((s) => s.text).join("")).join("\n");
  assertStringIncludes(text, "5-hour");
  assertStringIncludes(text, "resets in 2h10");
  assertStringIncludes(text, "holds before implement, review and merge at 90%");
  assertStringIncludes(text, "context 48% · cost $3.12");
  assertStringIncludes(text, "chain  plan ✓ tasks ✓ implement ✓ review ● merge ○");
  assertStringIncludes(text, "Tue 06 (today)");
  assertStringIncludes(text, "peak 5h 82%");
  assertStringIncludes(text, "app · feat/x");
});

Deno.test("the pane says when the hold is off and when nothing is measured", () => {
  const text = paneRows({
    reading: null,
    chain: IDLE,
    history: emptyHistory(),
    today: "2026-10-06",
    thresholds: { warnAt: 80, holdAt: 100 },
    now: NOW,
  }).map((r) => r.map((s) => s.text).join("")).join("\n");
  assertStringIncludes(text, "No rate-limit reading yet");
  assertStringIncludes(text, "The quota hold is off.");
  assertStringIncludes(text, "nothing measured yet");
});
