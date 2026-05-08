import { assertEquals } from "@std/assert";
import {
  DEFAULT_HARNESS,
  type PickerIO,
  pickHarness,
  pickHarnessInteractive,
} from "../../src/cli/harness_picker.ts";
import { HARNESSES } from "../../src/cli/harnesses.ts";
import type { SelectIO } from "../../src/cli/select.ts";

function scriptedIO(reads: ReadonlyArray<Uint8Array | null>): SelectIO {
  const queue = [...reads];
  return {
    write: () => {},
    readBytes: () => {
      const next = queue.shift();
      return Promise.resolve(next === undefined ? null : next);
    },
    teardown: () => {},
  };
}

function makeIO(inputs: ReadonlyArray<string | null>): {
  io: PickerIO;
  logs: string[];
  errs: string[];
} {
  const queue = [...inputs];
  const logs: string[] = [];
  const errs: string[] = [];
  return {
    io: {
      readLine: () => (queue.length > 0 ? queue.shift()! : null),
      log: (s: string) => logs.push(s),
      errLog: (s: string) => errs.push(s),
    },
    logs,
    errs,
  };
}

Deno.test("pickHarness returns the default on empty input", () => {
  const { io } = makeIO([""]);
  assertEquals(pickHarness(io), DEFAULT_HARNESS);
});

Deno.test("pickHarness lists every supported harness exactly once", () => {
  const { io, logs } = makeIO([""]);
  pickHarness(io);
  // 1 header line + 1 line per harness
  assertEquals(logs.length, 1 + HARNESSES.length);
  for (let i = 0; i < HARNESSES.length; i++) {
    assertEquals(logs[i + 1].includes(`${i + 1})`), true);
    assertEquals(logs[i + 1].includes(HARNESSES[i].displayName), true);
  }
});

Deno.test("pickHarness returns the picked harness for each valid 1-based index", () => {
  for (let i = 0; i < HARNESSES.length; i++) {
    const { io } = makeIO([String(i + 1)]);
    assertEquals(pickHarness(io), HARNESSES[i].key);
  }
});

Deno.test("pickHarness re-prompts on out-of-range and non-numeric input until a valid choice", () => {
  const { io, errs } = makeIO(["0", "9", "abc", "3"]);
  // index 2 (= "3") = codex in HARNESSES order
  assertEquals(pickHarness(io), HARNESSES[2].key);
  assertEquals(errs.length, 3);
  for (const e of errs) assertEquals(e.includes("invalid choice"), true);
});

Deno.test("pickHarness treats whitespace-only input as the default", () => {
  const { io } = makeIO(["   "]);
  assertEquals(pickHarness(io), DEFAULT_HARNESS);
});

Deno.test("pickHarness treats null (EOF / Ctrl-D) as the default", () => {
  const { io } = makeIO([null]);
  assertEquals(pickHarness(io), DEFAULT_HARNESS);
});

Deno.test("pickHarnessInteractive returns the default when Enter is pressed first", async () => {
  const io = scriptedIO([new Uint8Array([0x0d])]);
  assertEquals(await pickHarnessInteractive(io), DEFAULT_HARNESS);
});

Deno.test("pickHarnessInteractive returns the next harness after one arrow-down + space", async () => {
  const io = scriptedIO([
    new Uint8Array([0x1b, 0x5b, 0x42]),
    new Uint8Array([0x20]),
  ]);
  assertEquals(await pickHarnessInteractive(io), HARNESSES[1].key);
});

Deno.test("pickHarnessInteractive returns null on Ctrl-C cancel", async () => {
  const io = scriptedIO([new Uint8Array([0x03])]);
  assertEquals(await pickHarnessInteractive(io), null);
});
