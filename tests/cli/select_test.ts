import { assertEquals } from "@std/assert";
import {
  formatMenu,
  nextIndex,
  parseKey,
  selectInteractive,
  type SelectIO,
} from "../../src/cli/select.ts";

// ── nextIndex ──────────────────────────────────────────────────────────────

Deno.test("nextIndex 'down' increments and wraps from last to first", () => {
  assertEquals(nextIndex(0, 3, "down"), 1);
  assertEquals(nextIndex(2, 3, "down"), 0);
});

Deno.test("nextIndex 'up' decrements and wraps from first to last", () => {
  assertEquals(nextIndex(0, 3, "up"), 2);
  assertEquals(nextIndex(2, 3, "up"), 1);
});

Deno.test("nextIndex returns current for non-navigation actions", () => {
  assertEquals(nextIndex(1, 3, "select"), 1);
  assertEquals(nextIndex(1, 3, "cancel"), 1);
  assertEquals(nextIndex(1, 3, "noop"), 1);
});

// ── parseKey ───────────────────────────────────────────────────────────────

function bytes(...nums: number[]): Uint8Array {
  return new Uint8Array(nums);
}

Deno.test("parseKey maps arrow-up CSI sequence to 'up'", () => {
  assertEquals(parseKey(bytes(0x1b, 0x5b, 0x41)), "up");
});

Deno.test("parseKey maps arrow-down CSI sequence to 'down'", () => {
  assertEquals(parseKey(bytes(0x1b, 0x5b, 0x42)), "down");
});

Deno.test("parseKey maps 'k' to 'up' and 'j' to 'down' (vim bindings)", () => {
  assertEquals(parseKey(bytes(0x6b)), "up");
  assertEquals(parseKey(bytes(0x6a)), "down");
});

Deno.test("parseKey maps space and enter (CR or LF) to 'select'", () => {
  assertEquals(parseKey(bytes(0x20)), "select");
  assertEquals(parseKey(bytes(0x0d)), "select");
  assertEquals(parseKey(bytes(0x0a)), "select");
});

Deno.test("parseKey maps Ctrl-C, 'q', and lone ESC to 'cancel'", () => {
  assertEquals(parseKey(bytes(0x03)), "cancel");
  assertEquals(parseKey(bytes(0x71)), "cancel");
  assertEquals(parseKey(bytes(0x1b)), "cancel");
});

Deno.test("parseKey returns 'noop' for unknown bytes", () => {
  assertEquals(parseKey(bytes(0x7a)), "noop");
  assertEquals(parseKey(bytes()), "noop");
});

// ── formatMenu ─────────────────────────────────────────────────────────────

Deno.test("formatMenu marks the current item with '❯' and indents the rest", () => {
  const out = formatMenu(["alpha", "beta", "gamma"], 1, "Pick:");
  const lines = out.split("\n");
  assertEquals(lines[0], "Pick:");
  assertEquals(lines[1], "    alpha");
  assertEquals(lines[2], "  ❯ beta");
  assertEquals(lines[3], "    gamma");
});

Deno.test("formatMenu highlights the first item when currentIndex is 0", () => {
  const out = formatMenu(["a", "b"], 0, "P");
  const lines = out.split("\n");
  assertEquals(lines[1], "  ❯ a");
  assertEquals(lines[2], "    b");
});

Deno.test("formatMenu emits header + n item lines (no trailing newline)", () => {
  const out = formatMenu(["a", "b", "c"], 0, "P");
  assertEquals(out.split("\n").length, 4);
  assertEquals(out.endsWith("\n"), false);
});

// ── selectInteractive driver ──────────────────────────────────────────────

function fakeIO(scriptedReads: ReadonlyArray<Uint8Array | null>): {
  io: SelectIO;
  written: string[];
  teardownCalls: number;
} {
  const queue = [...scriptedReads];
  const written: string[] = [];
  const state = { teardownCalls: 0 };
  const io: SelectIO = {
    write: (s: string) => {
      written.push(s);
    },
    readBytes: () => {
      const next = queue.shift();
      return Promise.resolve(next === undefined ? null : next);
    },
    teardown: () => {
      state.teardownCalls++;
    },
  };
  return {
    io,
    written,
    get teardownCalls() {
      return state.teardownCalls;
    },
  };
}

Deno.test("selectInteractive returns the default item key when user presses Enter immediately", async () => {
  const { io } = fakeIO([new Uint8Array([0x0d])]);
  const result = await selectInteractive(
    [
      { key: "a", label: "Alpha" },
      { key: "b", label: "Beta" },
      { key: "c", label: "Gamma" },
    ],
    1,
    io,
    "Pick:",
  );
  assertEquals(result, "b");
});

Deno.test("selectInteractive moves down then selects the next item", async () => {
  const { io } = fakeIO([
    new Uint8Array([0x1b, 0x5b, 0x42]),
    new Uint8Array([0x20]),
  ]);
  const result = await selectInteractive(
    [
      { key: "a", label: "Alpha" },
      { key: "b", label: "Beta" },
    ],
    0,
    io,
    "Pick:",
  );
  assertEquals(result, "b");
});

Deno.test("selectInteractive returns null when user cancels with Ctrl-C", async () => {
  const { io } = fakeIO([new Uint8Array([0x03])]);
  const result = await selectInteractive(
    [{ key: "x", label: "X" }],
    0,
    io,
    "P:",
  );
  assertEquals(result, null);
});

Deno.test("selectInteractive returns null on EOF (readBytes returns null)", async () => {
  const { io } = fakeIO([null]);
  const result = await selectInteractive(
    [{ key: "x", label: "X" }],
    0,
    io,
    "P:",
  );
  assertEquals(result, null);
});

Deno.test("selectInteractive writes a redraw frame on every input event", async () => {
  const { io, written } = fakeIO([
    new Uint8Array([0x6a]),
    new Uint8Array([0x0d]),
  ]);
  await selectInteractive(
    [
      { key: "a", label: "Alpha" },
      { key: "b", label: "Beta" },
    ],
    0,
    io,
    "Pick:",
  );
  const frames = written.filter((s) => s.includes("Pick:"));
  assertEquals(frames.length >= 2, true);
});

Deno.test("selectInteractive calls teardown exactly once on normal selection", async () => {
  const fake = fakeIO([new Uint8Array([0x0d])]);
  await selectInteractive(
    [{ key: "x", label: "X" }],
    0,
    fake.io,
    "P:",
  );
  assertEquals(fake.teardownCalls, 1);
});

Deno.test("selectInteractive calls teardown exactly once on cancel", async () => {
  const fake = fakeIO([new Uint8Array([0x03])]);
  await selectInteractive(
    [{ key: "x", label: "X" }],
    0,
    fake.io,
    "P:",
  );
  assertEquals(fake.teardownCalls, 1);
});
