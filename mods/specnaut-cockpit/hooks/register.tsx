// Specnaut Cockpit — the hooks module.
//
// Wiring only: every decision is made in ./core/, which is pure and covered by
// `deno test` in the specnaut-cli repository. This file reads what Claude Code
// pushes, keeps it in session state, and draws it.
//
// What it does, and the one place it acts rather than observes:
//   - draws a band above the prompt: usage windows, context, cost, chain;
//   - announces a window once per threshold, as a toast;
//   - keeps a local history of cost and peaks per day and per git branch;
//   - serves `/cockpit` (a pane), `/cockpit hide` and `/cockpit show`;
//   - REFUSES one kind of tool call: the Skill call that starts `implement`,
//     `review` or `merge` of the `specnaut` skill while a usage window is at
//     or above the hold threshold. Nothing else is ever refused or rewritten.

import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import { alertsFor } from "./core/alerts.ts";
import { bandSegments, type Segment } from "./core/band.ts";
import { IDLE, phaseOf, phaseOfPrompt, promptSubmitted, turnEnded } from "./core/chain.ts";
import { asHistory, costDelta, localDay, prune, record } from "./core/history.ts";
import { holdFor, lift } from "./core/hold.ts";
import { paneRows } from "./core/pane.ts";
import { type Reading, thresholdsFrom } from "./core/usage.ts";

const PANE = "cockpit";
const HISTORY_KEY = "history";

const reading = atom({ plugin: "specnaut-cockpit", key: "reading" } as const, null);
const chain = atom({ plugin: "specnaut-cockpit", key: "chain" } as const, IDLE);
const isHidden = atom({ plugin: "specnaut-cockpit", key: "isHidden" } as const, false);
const alerts = atom({ plugin: "specnaut-cockpit", key: "alerts" } as const, {});
const held = atom({ plugin: "specnaut-cockpit", key: "held" } as const, []);
const lifted = atom({ plugin: "specnaut-cockpit", key: "lifted" } as const, {});
const costSeen = atom({ plugin: "specnaut-cockpit", key: "costSeen" } as const, 0);

type Measured = {
  context?: { percent?: number };
  rateLimits?: readonly { kind: string; percentUsed: number; resetsAt?: string }[];
  cost?: { usd: number };
};

function toReading(m: Measured): Reading {
  return {
    windows: (m.rateLimits ?? []).map((w) => ({
      kind: w.kind,
      percentUsed: w.percentUsed,
      resetsAt: w.resetsAt,
    })),
    contextPercent: m.context?.percent,
    costUsd: m.cost?.usd,
  };
}

const COLOR: Record<Segment["tone"], { color?: string; dimColor?: boolean }> = {
  normal: {},
  dim: { dimColor: true },
  warn: { color: "yellow" },
  alert: { color: "red" },
};

// The branch a cost is recorded against, refreshed at most once a minute.
let branch: { key: string; label: string } | undefined;
let branchAt = Number.NEGATIVE_INFINITY;

async function currentBranch($: EngineInterface) {
  const now = await $.clock.now();
  if (now - branchAt < 60_000) return branch;
  branchAt = now;
  try {
    const top = await $.process.run(["git", "rev-parse", "--show-toplevel"], { timeoutMs: 5_000 });
    const ref = await $.process.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
      timeoutMs: 5_000,
    });
    if (top.exitCode === 0 && ref.exitCode === 0) {
      const root = top.stdout.trim();
      const name = ref.stdout.trim();
      branch = { key: `${root}#${name}`, label: `${root.split("/").at(-1)} · ${name}` };
    } else {
      branch = undefined;
    }
  } catch {
    branch = undefined;
  }
  return branch;
}

export const register: Register = (on, options) => {
  const opts = options as Record<string, unknown> | undefined;
  const t = thresholdsFrom(opts);
  const showBand = opts?.band !== false;
  const offsetMinutes = -new Date().getTimezoneOffset();

  on("session.start", async ($, e, next) => {
    const started = await next(e);
    await $.command.register({
      name: "cockpit",
      description: "Usage limits, cost history and the Specnaut chain (hide | show)",
      argumentHint: "[hide|show]",
      immediate: true,
    });
    const usage = await $.session.usage();
    await update($, reading, () => toReading(usage));
    // The baseline the history counts from: a resumed session's earlier cost
    // was recorded when it was spent.
    await update($, costSeen, () => usage.cost?.usd ?? 0);
    // Reset times read as "in 2h10": redraw once a minute so they count down.
    $.clock.every(60_000, () => $.ui.invalidate("ui.render"));
    return started;
  });

  on("session.measure", async ($, e, next) => {
    const r = toReading(e);
    await update($, reading, () => r);

    const now = await $.clock.now();
    const steps = t.holdAt < 100 ? [t.warnAt, t.holdAt] : [t.warnAt];
    const memo = await read($, alerts);
    const out = alertsFor(r.windows, memo, steps, now);
    await update($, alerts, () => out.memo);
    for (const text of out.toasts) $.ui.toast(text);

    const seen = await read($, costSeen);
    const delta = costDelta(seen, r.costUsd);
    if (r.costUsd !== undefined) await update($, costSeen, () => r.costUsd as number);
    const day = localDay(now, offsetMinutes);
    const history = record(asHistory(await $.store.get(HISTORY_KEY)), {
      day,
      costDelta: delta,
      windows: r.windows,
      branch: delta > 0 ? await currentBranch($) : undefined,
    });
    await $.store.set(HISTORY_KEY, prune(history, day));

    return next(e);
  });

  // The quota hold, and the chain's progress as the autopilot crosses phases.
  on("tool.call", { tool: "Skill" }, async ($, e, next) => {
    const phase = phaseOf(e.skill, e.args);
    if (!phase) return next(e);
    const r = await read($, reading);
    const hold = holdFor(
      phase,
      r?.windows ?? [],
      t.holdAt,
      await read($, lifted),
      await $.clock.now(),
    );
    if (hold) {
      await update($, held, () => [hold.window]);
      $.ui.toast(
        `Autopilot held before ${phase}: ${hold.window.kind} at ${
          Math.round(hold.window.percentUsed)
        }%`,
      );
      return { deny: hold.reason };
    }
    await update($, chain, (s) => promptSubmitted(s, phase));
    return next(e);
  }).catch((_$, e, next) => next(e)); // a cockpit fault never blocks a tool call

  on("prompt.submit", async ($, e, next) => {
    // The person's next message answers a hold: if they ask to go on, the
    // same window does not hold the chain again.
    const pending = await read($, held);
    if (pending.length > 0) {
      await update($, lifted, (l) => lift(l, pending));
      await update($, held, () => []);
    }
    await update($, chain, (s) => promptSubmitted(s, phaseOfPrompt(e.text)));
    return next(e);
  }).catch((_$, e, next) => next(e)); // nor a prompt

  on("turn.complete", async ($, e, next) => {
    await update($, chain, turnEnded);
    return next(e);
  });

  on("session.end", async ($, e, next) => {
    if (e.reason === "clear") await update($, chain, () => IDLE);
    return next(e);
  });

  on("command.run", { command: "cockpit" }, async ($, e) => {
    const arg = e.args.trim();
    if (arg === "hide") {
      await update($, isHidden, () => true);
      return { text: "Cockpit band hidden for this session. /cockpit show brings it back." };
    }
    if (arg === "show") {
      await update($, isHidden, () => false);
      return { text: "Cockpit band shown." };
    }
    await $.ui.open({ id: PANE, title: "Specnaut Cockpit" });
    return { text: "Cockpit pane opened." };
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (!showBand || e.props.hasSurvey || (await read($, isHidden))) return next(e);
    const segments = bandSegments(
      await read($, reading),
      await read($, chain),
      t,
      e.props.bodyColumns,
      await $.clock.now(),
    );
    if (segments.length === 0) return next(e);
    const { Box, Text } = $.ui.resolve(e);
    return (
      <Box key="cockpit-band">
        <Text wrap="truncate-end">
          {segments.map((s, i) => <Text key={`s${i}`} {...COLOR[s.tone]}>{s.text}</Text>)}
        </Text>
      </Box>
    );
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e);
    const now = await $.clock.now();
    const today = localDay(now, offsetMinutes);
    const rows = paneRows({
      reading: await read($, reading),
      chain: await read($, chain),
      history: asHistory(await $.store.get(HISTORY_KEY)),
      today,
      thresholds: t,
      now,
    });
    return (
      <Box flexDirection="column">
        {rows.map((row, r) => (
          <Text key={`r${r}`} wrap="truncate-end">
            {row.length === 0
              ? " "
              : row.map((s, i) => <Text key={`r${r}s${i}`} {...COLOR[s.tone]}>{s.text}</Text>)}
          </Text>
        ))}
      </Box>
    );
  });
};
