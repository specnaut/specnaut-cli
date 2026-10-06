// The hooks module under `claude plugin test`: the wiring, not the logic.
// What each decision computes is covered by tests/cockpit/core_test.ts in
// specnaut-cli; these check that the engine's events reach it and that its
// answers reach the engine.

import { expect, mock, test } from "claude-code/testing";
import type { On, UsageUnit } from "claude-code";

const NOW = Date.parse("2026-10-06T12:00:00Z");
const SOON = new Date(NOW + 65 * 60_000).toISOString();

/** The world beneath the plugin: a clock, a store, and the measure chain's bottom. */
function world(on: On) {
  mock.clock(on, { now: NOW });
  mock.store(on);
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("process.run", () => ({
    value: {
      exitCode: 128,
      stdout: "",
      stderr: "not a git repository",
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }));
  on("ui.toast", () => ({ value: undefined }));
  // What Claude Code itself draws in the band when no plugin draws: nothing.
  on("ui.render", { component: "AbovePrompt" }, ($, e) => {
    const { Box } = $.ui.resolve(e);
    return <Box key="engine-band" />;
  });
}

/** A command as the person types it at the terminal. */
const TYPED = {
  origin: { kind: "composer" as const },
  presentation: { isFullscreen: false, columns: 160 },
};

const measure = (fiveHour: number, cost = 1.25) => ({
  context: { window: 200_000, tokens: 96_000, percent: 48 },
  rateLimits: [
    { kind: "five_hour", percentUsed: fiveHour, resetsAt: SOON },
    { kind: "seven_day", percentUsed: 31 },
  ],
  cost: { usd: cost },
  changed: ["context", "rateLimits", "cost"] as UsageUnit[],
});

const band = (columns = 160) => ({
  plugin: "specnaut-cockpit",
  surface: "terminal" as const,
  component: "AbovePrompt" as const,
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: columns,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
});

test(
  "the autopilot is held before merge when the 5-hour window is past the threshold",
  async ($, on) => {
    world(on);
    let ran = false;
    on("tool.call", { tool: "Skill" }, () => {
      ran = true;
      return { result: { success: true, commandName: "specnaut" } };
    });
    await $.session.measure(measure(93));
    const out = await $.tool.call({ tool: "Skill", skill: "specnaut", args: "merge" });
    expect(ran).toBe(false);
    expect(out.text ?? out.deny ?? "").toMatch(/quota hold before `merge`/);
  },
);

test("below the threshold the chain goes through, and the band shows its phase", async ($, on) => {
  world(on);
  let ran = false;
  on("tool.call", { tool: "Skill" }, () => {
    ran = true;
    return { result: { success: true, commandName: "specnaut" } };
  });
  await $.session.measure(measure(42));
  await $.tool.call({ tool: "Skill", skill: "specnaut", args: "implement" });
  expect(ran).toBe(true);
  const ui = await $.ui.mount(band());
  expect(await ui.find({ type: "Text", text: /implement ●/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /5h/ })).toBeDefined();
  await ui.unmount();
});

test("unrelated skills are never touched, whatever the usage", async ($, on) => {
  world(on);
  let ran = false;
  on("tool.call", { tool: "Skill" }, () => {
    ran = true;
    return { result: { success: true, commandName: "board" } };
  });
  await $.session.measure(measure(99));
  await $.tool.call({ tool: "Skill", skill: "board", args: "merge" });
  expect(ran).toBe(true);
});

test("the person's next message lifts the hold for that window", async ($, on) => {
  world(on);
  let runs = 0;
  on("tool.call", { tool: "Skill" }, () => {
    runs += 1;
    return { result: { success: true, commandName: "specnaut" } };
  });
  on("prompt.submit", (_$, e) => ({ text: e.text }));
  await $.session.measure(measure(95));
  await $.tool.call({ tool: "Skill", skill: "specnaut", args: "review" });
  expect(runs).toBe(0);
  await $.prompt.submit({ text: "continue anyway", wait: false, origin: { kind: "composer" } });
  await $.tool.call({ tool: "Skill", skill: "specnaut", args: "review" });
  expect(runs).toBe(1);
});

test("/cockpit hide clears the band and /cockpit show brings it back", async ($, on) => {
  world(on);
  await $.session.measure(measure(42));
  await $.command.run({ command: "cockpit", args: "hide", ...TYPED });
  let ui = await $.ui.mount(band());
  expect(await ui.find({ type: "Text", text: /5h/ })).toBeUndefined();
  await ui.unmount();
  await $.command.run({ command: "cockpit", args: "show", ...TYPED });
  ui = await $.ui.mount(band());
  expect(await ui.find({ type: "Text", text: /5h/ })).toBeDefined();
  await ui.unmount();
});
