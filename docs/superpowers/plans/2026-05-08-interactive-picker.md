# Interactive arrow-key picker for `specflow init` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the numeric "Choose [1-N]:" prompts in `specflow init` (harness + backlog backend)
with a hand-rolled interactive radio-style picker — arrow keys / j-k to navigate, space or enter to
select — using `Deno.stdin.setRaw()` directly. Zero new runtime deps. Non-TTY input keeps working
via the existing numeric `pickHarness` / `pickBacklogBackend` functions.

**Architecture:** A single new module `src/cli/select.ts` exposes (a) pure helpers `nextIndex`,
`parseKey`, `formatMenu` that are trivially unit-testable, and (b) a
`selectInteractive<T>(items, defaultIndex, io)` async driver that wraps them around `Deno.stdin`
reads and ANSI redraw escapes. The default `SelectIO` factory uses `Deno.stdin.setRaw(true)` + a
small read buffer; tests inject a scripted-byte fake instead. Two thin wrappers
`pickHarnessInteractive` / `pickBacklogBackendInteractive` reuse the existing `HARNESSES` /
`BACKLOG_STRATEGIES` arrays. `init_handler.ts` calls the interactive variant when stdin is a TTY,
and falls back to the existing numeric pickers when it isn't (preserves piped input like
`echo 1 | specflow init`).

**Tech Stack:** Deno, TypeScript, `@std/assert`, ANSI escape sequences (cursor up + clear-to-end).
No new runtime dependencies.

**Issue:** mkrlabs/specflow#96 (column: In progress).

---

## File Structure

| Path                               | Purpose                                                                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/cli/select.ts`                | New. Pure helpers (`nextIndex`, `parseKey`, `formatMenu`) + driver (`selectInteractive`) + factory (`makeStdinSelectIO`).                                         |
| `tests/cli/select_test.ts`         | New. Unit tests for the three pure helpers + a driver test using a scripted fake `SelectIO`.                                                                      |
| `src/cli/harness_picker.ts`        | Modify. Add `pickHarnessInteractive(io)` that delegates to `selectInteractive` over `HARNESSES`. Keep `pickHarness` (numeric) untouched for the non-TTY fallback. |
| `src/cli/backlog_picker.ts`        | Modify. Add `pickBacklogBackendInteractive(io)` that delegates to `selectInteractive` over `BACKLOG_STRATEGIES`. Keep `pickBacklogBackend` (numeric) untouched.   |
| `src/cli/handlers/init_handler.ts` | Modify. `resolveHarnessKey` / `resolveBacklogBackend` route to interactive picker when `Deno.stdin.isTerminal()`, numeric picker otherwise.                       |
| `tests/cli/harness_picker_test.ts` | Modify. Add tests for `pickHarnessInteractive`.                                                                                                                   |
| `tests/cli/backlog_picker_test.ts` | Modify. Add tests for `pickBacklogBackendInteractive`.                                                                                                            |

The numeric pickers stay so the piped-stdin path (`echo 1 | specflow init`) keeps working — that's
the explicit non-TTY fallback Kevin asked for.

---

### Task 1: Pure helper — `nextIndex`

**Files:**

- Create: `src/cli/select.ts`
- Create: `tests/cli/select_test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/select_test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { nextIndex } from "../../src/cli/select.ts";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test tests/cli/select_test.ts -A --no-check` Expected: FAIL —
`module not found: src/cli/select.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/cli/select.ts`:

```typescript
export type SelectAction = "up" | "down" | "select" | "cancel" | "noop";

export function nextIndex(current: number, n: number, action: SelectAction): number {
  if (action === "up") return (current - 1 + n) % n;
  if (action === "down") return (current + 1) % n;
  return current;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test tests/cli/select_test.ts -A --no-check` Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/cli/select.ts tests/cli/select_test.ts
git commit -m "feat(select): add pure nextIndex helper for radio navigation"
```

---

### Task 2: Pure helper — `parseKey` byte→action mapper

**Files:**

- Modify: `src/cli/select.ts`
- Modify: `tests/cli/select_test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/cli/select_test.ts`:

```typescript
import { parseKey } from "../../src/cli/select.ts";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test tests/cli/select_test.ts -A --no-check` Expected: FAIL — `parseKey` not exported
from `src/cli/select.ts`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/cli/select.ts`:

```typescript
/**
 * Parse the bytes produced by a single keypress in raw-mode stdin into a
 * high-level action. Unrecognised input maps to "noop" so the caller can
 * just keep reading without blowing up on stray bytes (e.g. window-resize
 * sequences). Multi-byte CSI sequences (arrow keys) are 3 bytes; lone ESC
 * (1 byte) maps to cancel.
 */
export function parseKey(buf: Uint8Array): SelectAction {
  if (buf.length === 0) return "noop";
  const b0 = buf[0];
  if (buf.length >= 3 && b0 === 0x1b && buf[1] === 0x5b) {
    if (buf[2] === 0x41) return "up";
    if (buf[2] === 0x42) return "down";
    return "noop";
  }
  if (buf.length === 1 && b0 === 0x1b) return "cancel";
  if (b0 === 0x03 || b0 === 0x71) return "cancel";
  if (b0 === 0x6b) return "up";
  if (b0 === 0x6a) return "down";
  if (b0 === 0x20 || b0 === 0x0d || b0 === 0x0a) return "select";
  return "noop";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test tests/cli/select_test.ts -A --no-check` Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/cli/select.ts tests/cli/select_test.ts
git commit -m "feat(select): add parseKey byte-to-action mapper"
```

---

### Task 3: Pure helper — `formatMenu` builds the redraw frame

**Files:**

- Modify: `src/cli/select.ts`
- Modify: `tests/cli/select_test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/cli/select_test.ts`:

```typescript
import { formatMenu } from "../../src/cli/select.ts";

Deno.test("formatMenu marks the current item with '❯' and indents the rest with '  '", () => {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test tests/cli/select_test.ts -A --no-check` Expected: FAIL — `formatMenu` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/cli/select.ts`:

```typescript
/**
 * Build the textual menu frame as a single string with newlines between
 * lines (no trailing newline — the driver decides whether to add one when
 * writing to the terminal). Header on line 0; one line per item; the
 * current item is prefixed with "  ❯ " and the others with "    ".
 */
export function formatMenu(
  labels: ReadonlyArray<string>,
  currentIndex: number,
  header: string,
): string {
  const lines = [header];
  for (let i = 0; i < labels.length; i++) {
    lines.push(i === currentIndex ? `  ❯ ${labels[i]}` : `    ${labels[i]}`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test tests/cli/select_test.ts -A --no-check` Expected: PASS — 12 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/cli/select.ts tests/cli/select_test.ts
git commit -m "feat(select): add formatMenu pure renderer"
```

---

### Task 4: Driver — `selectInteractive<T>` async loop

**Files:**

- Modify: `src/cli/select.ts`
- Modify: `tests/cli/select_test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/cli/select_test.ts`:

```typescript
import { selectInteractive, type SelectIO } from "../../src/cli/select.ts";

function fakeIO(scriptedReads: ReadonlyArray<Uint8Array | null>): {
  io: SelectIO;
  written: string[];
} {
  const queue = [...scriptedReads];
  const written: string[] = [];
  const io: SelectIO = {
    write: (s: string) => {
      written.push(s);
    },
    readBytes: () => {
      const next = queue.shift();
      return Promise.resolve(next === undefined ? null : next);
    },
    teardown: () => {},
  };
  return { io, written };
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
    new Uint8Array([0x1b, 0x5b, 0x42]), // arrow down
    new Uint8Array([0x20]), // space → select
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
    new Uint8Array([0x6a]), // j → down
    new Uint8Array([0x0d]), // enter → select
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
  // Initial draw + 1 redraw after 'j' = 2 frames. Final draw on selection
  // is up to the implementation; we only assert at least 2.
  const frames = written.filter((s) => s.includes("Pick:"));
  assertEquals(frames.length >= 2, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test tests/cli/select_test.ts -A --no-check` Expected: FAIL — `selectInteractive` and
`SelectIO` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/cli/select.ts`:

```typescript
export type SelectItem<T> = { key: T; label: string };

export type SelectIO = {
  write(s: string): void;
  readBytes(): Promise<Uint8Array | null>;
  teardown(): void;
};

/**
 * Run an interactive radio-style picker. Returns the chosen item's key,
 * or `null` if the user cancelled (Ctrl-C / ESC / q / EOF).
 *
 * Render strategy: write the frame, then on every keypress write
 * `\x1b[<n>A` to move the cursor back up `n` lines (where n = number of
 * lines in the previous frame), then `\x1b[J` to clear from the cursor to
 * end-of-screen, then write the new frame. This keeps the menu in place
 * instead of scrolling new copies.
 */
export async function selectInteractive<T>(
  items: ReadonlyArray<SelectItem<T>>,
  defaultIndex: number,
  io: SelectIO,
  header: string,
): Promise<T | null> {
  if (items.length === 0) return null;
  let current = Math.max(0, Math.min(defaultIndex, items.length - 1));
  const labels = items.map((i) => i.label);
  const totalLines = labels.length + 1; // header + items

  try {
    io.write(formatMenu(labels, current, header) + "\n");
    while (true) {
      const buf = await io.readBytes();
      if (buf === null) return null;
      const action = parseKey(buf);
      if (action === "cancel") return null;
      if (action === "select") return items[current].key;
      current = nextIndex(current, items.length, action);
      io.write(`\x1b[${totalLines}A\x1b[J`);
      io.write(formatMenu(labels, current, header) + "\n");
    }
  } finally {
    io.teardown();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test tests/cli/select_test.ts -A --no-check` Expected: PASS — 17 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/cli/select.ts tests/cli/select_test.ts
git commit -m "feat(select): add selectInteractive driver"
```

---

### Task 5: Default `SelectIO` factory backed by `Deno.stdin.setRaw`

**Files:**

- Modify: `src/cli/select.ts`

This factory is not unit-tested directly (it requires a real TTY); it's exercised end-to-end via the
test-sandbox in Task 9. The pure helpers and the driver are already covered.

- [ ] **Step 1: Append the factory to `src/cli/select.ts`**

```typescript
/**
 * Default SelectIO that puts stdin into raw mode, reads up to 8 bytes per
 * keypress (enough for any CSI sequence we recognise), writes via
 * Deno.stdout. `teardown` flips raw mode back off.
 */
export function makeStdinSelectIO(): SelectIO {
  Deno.stdin.setRaw(true);
  const encoder = new TextEncoder();
  const buf = new Uint8Array(8);
  return {
    write: (s: string) => {
      Deno.stdout.writeSync(encoder.encode(s));
    },
    readBytes: async () => {
      const n = await Deno.stdin.read(buf);
      if (n === null) return null;
      return buf.slice(0, n);
    },
    teardown: () => {
      try {
        Deno.stdin.setRaw(false);
      } catch {
        // already off, or stdin already closed — ignore
      }
    },
  };
}
```

- [ ] **Step 2: Type-check**

Run: `deno check src/cli/select.ts` Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/cli/select.ts
git commit -m "feat(select): add makeStdinSelectIO factory"
```

---

### Task 6: `pickHarnessInteractive` wrapper

**Files:**

- Modify: `src/cli/harness_picker.ts`
- Modify: `tests/cli/harness_picker_test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/cli/harness_picker_test.ts`:

```typescript
import { pickHarnessInteractive } from "../../src/cli/harness_picker.ts";
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

Deno.test("pickHarnessInteractive returns the default when Enter is pressed first", async () => {
  const io = scriptedIO([new Uint8Array([0x0d])]);
  assertEquals(await pickHarnessInteractive(io), DEFAULT_HARNESS);
});

Deno.test("pickHarnessInteractive returns the next harness after one arrow-down + select", async () => {
  const io = scriptedIO([
    new Uint8Array([0x1b, 0x5b, 0x42]),
    new Uint8Array([0x20]),
  ]);
  const result = await pickHarnessInteractive(io);
  assertEquals(result, HARNESSES[1].key);
});

Deno.test("pickHarnessInteractive returns null on cancel", async () => {
  const io = scriptedIO([new Uint8Array([0x03])]);
  assertEquals(await pickHarnessInteractive(io), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test tests/cli/harness_picker_test.ts -A --no-check` Expected: FAIL —
`pickHarnessInteractive` not exported.

- [ ] **Step 3: Implement the wrapper**

Append to `src/cli/harness_picker.ts`:

```typescript
import { selectInteractive, type SelectIO } from "./select.ts";

export async function pickHarnessInteractive(io: SelectIO): Promise<HarnessKey | null> {
  const defaultIdx = HARNESSES.findIndex((h) => h.key === DEFAULT_HARNESS);
  const items = HARNESSES.map((h) => ({
    key: h.key as HarnessKey,
    label: h.key === DEFAULT_HARNESS ? `${h.displayName} (default)` : h.displayName,
  }));
  return await selectInteractive(
    items,
    defaultIdx >= 0 ? defaultIdx : 0,
    io,
    "Choose your AI harness (↑/↓ to move, space/enter to select, Ctrl-C to cancel):",
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test tests/cli/harness_picker_test.ts -A --no-check` Expected: PASS — all old + 3 new
tests green.

- [ ] **Step 5: Commit**

```bash
git add src/cli/harness_picker.ts tests/cli/harness_picker_test.ts
git commit -m "feat(picker): add pickHarnessInteractive over selectInteractive"
```

---

### Task 7: `pickBacklogBackendInteractive` wrapper

**Files:**

- Modify: `src/cli/backlog_picker.ts`
- Modify: `tests/cli/backlog_picker_test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/cli/backlog_picker_test.ts`:

```typescript
import { pickBacklogBackendInteractive } from "../../src/cli/backlog_picker.ts";
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

Deno.test("pickBacklogBackendInteractive returns 'local' on Enter (default)", async () => {
  const io = scriptedIO([new Uint8Array([0x0d])]);
  assertEquals(await pickBacklogBackendInteractive(io), "local");
});

Deno.test("pickBacklogBackendInteractive returns 'github' after one arrow-down + select", async () => {
  const io = scriptedIO([
    new Uint8Array([0x1b, 0x5b, 0x42]),
    new Uint8Array([0x20]),
  ]);
  assertEquals(await pickBacklogBackendInteractive(io), "github");
});

Deno.test("pickBacklogBackendInteractive returns null on Ctrl-C", async () => {
  const io = scriptedIO([new Uint8Array([0x03])]);
  assertEquals(await pickBacklogBackendInteractive(io), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test tests/cli/backlog_picker_test.ts -A --no-check` Expected: FAIL —
`pickBacklogBackendInteractive` not exported.

- [ ] **Step 3: Implement the wrapper**

Append to `src/cli/backlog_picker.ts`:

```typescript
import { selectInteractive, type SelectIO } from "./select.ts";

export async function pickBacklogBackendInteractive(
  io: SelectIO,
): Promise<BacklogBackend | null> {
  const defaultIdx = BACKLOG_STRATEGIES.findIndex((s) => s.key === DEFAULT_BACKLOG_BACKEND);
  const items = BACKLOG_STRATEGIES.map((s) => ({
    key: s.key,
    label: s.key === DEFAULT_BACKLOG_BACKEND ? `${s.displayName} (default)` : s.displayName,
  }));
  return await selectInteractive(
    items,
    defaultIdx >= 0 ? defaultIdx : 0,
    io,
    "Choose your backlog backend (↑/↓ to move, space/enter to select, Ctrl-C to cancel):",
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test tests/cli/backlog_picker_test.ts -A --no-check` Expected: PASS — all old + 3 new
tests green.

- [ ] **Step 5: Commit**

```bash
git add src/cli/backlog_picker.ts tests/cli/backlog_picker_test.ts
git commit -m "feat(picker): add pickBacklogBackendInteractive over selectInteractive"
```

---

### Task 8: Wire interactive picker into `init_handler`

**Files:**

- Modify: `src/cli/handlers/init_handler.ts`

- [ ] **Step 1: Replace the two resolvers**

In `src/cli/handlers/init_handler.ts`, change the imports near the top — add:

```typescript
import { pickHarnessInteractive } from "../harness_picker.ts";
import { pickBacklogBackendInteractive } from "../backlog_picker.ts";
import { makeStdinSelectIO } from "../select.ts";
```

Keep the existing `pickHarness` / `pickBacklogBackend` imports (still used as the non-TTY numeric
fallback).

Then replace:

```typescript
function resolveHarnessKey(explicit: HarnessKey | null): HarnessKey {
  if (explicit !== null) return explicit;
  if (!Deno.stdin.isTerminal()) return DEFAULT_HARNESS;
  return pickHarness({
    readLine: () => prompt("Choose [1-8]:"),
    log: (s) => console.log(s),
    errLog: (s) => console.error(red(s)),
  });
}

function resolveBacklogBackend(explicit: BacklogBackend | null): BacklogBackend {
  if (explicit !== null) return explicit;
  if (!Deno.stdin.isTerminal()) return DEFAULT_BACKLOG_BACKEND;
  return pickBacklogBackend({
    readLine: () => prompt("Choose [1-3]:"),
    log: (s) => console.log(s),
    errLog: (s) => console.error(red(s)),
  });
}
```

with:

```typescript
async function resolveHarnessKey(explicit: HarnessKey | null): Promise<HarnessKey> {
  if (explicit !== null) return explicit;
  if (!Deno.stdin.isTerminal()) {
    // Non-TTY: read a numeric line if the user piped one in, else default.
    return pickHarness({
      readLine: () => prompt("Choose [1-8]:"),
      log: (s) => console.log(s),
      errLog: (s) => console.error(red(s)),
    });
  }
  const picked = await pickHarnessInteractive(makeStdinSelectIO());
  if (picked === null) {
    console.error(red("aborted."));
    Deno.exit(130);
  }
  return picked;
}

async function resolveBacklogBackend(
  explicit: BacklogBackend | null,
): Promise<BacklogBackend> {
  if (explicit !== null) return explicit;
  if (!Deno.stdin.isTerminal()) {
    return pickBacklogBackend({
      readLine: () => prompt("Choose [1-3]:"),
      log: (s) => console.log(s),
      errLog: (s) => console.error(red(s)),
    });
  }
  const picked = await pickBacklogBackendInteractive(makeStdinSelectIO());
  if (picked === null) {
    console.error(red("aborted."));
    Deno.exit(130);
  }
  return picked;
}
```

Then update the two callsites in `runInit` from `resolveHarnessKey(intent.ai)` to
`await resolveHarnessKey(intent.ai)` and `resolveBacklogBackend(intent.backlog)` to
`await resolveBacklogBackend(intent.backlog)`.

- [ ] **Step 2: Type-check**

Run: `deno check src/main.ts` Expected: no errors.

- [ ] **Step 3: Run the full test suite**

Run: `deno task test` Expected: PASS — 349 + 16 (Task 1–7 additions) = 365 tests, all green.

- [ ] **Step 4: Commit**

```bash
git add src/cli/handlers/init_handler.ts
git commit -m "feat(init): use interactive picker for harness + backlog prompts"
```

---

### Task 9: Manual smoke-test via test-sandbox

**Files:**

- None modified.

The interactive driver requires a real TTY, so this can't be unit-tested with the same fakes —
exercise it end-to-end via the sandbox.

- [ ] **Step 1: Bootstrap a fresh sandbox**

```bash
bash .claude/skills/test-sandbox/scripts/bootstrap-empty.sh picker-smoke
```

Expected: `sandbox/picker-smoke/` exists with a stub `package.json` + `git init`.

- [ ] **Step 2: Run init from the source tree (interactive)**

```bash
(cd sandbox/picker-smoke && deno run --allow-all ../../src/main.ts init --here --no-git)
```

Expected: a menu like

```
Choose your AI harness (↑/↓ to move, space/enter to select, Ctrl-C to cancel):
  ❯ Claude Code (default)
    Cursor
    ...
```

Pressing arrow keys should move the `❯` marker without redrawing copies underneath. Pressing space
or Enter selects. Pressing Ctrl-C aborts with `aborted.` and exits non-zero.

- [ ] **Step 3: Confirm non-TTY fallback still works**

```bash
echo "" | (cd sandbox/picker-smoke && deno run --allow-all ../../src/main.ts init --here --no-git --ai claude --backlog local)
```

Expected: exits 0 (or 3 if conflicts), no interactive picker shown — the explicit flags bypass both
prompts. Re-runs are idempotent.

- [ ] **Step 4: Confirm `echo 1 | ...` numeric fallback**

```bash
rm -rf sandbox/picker-smoke && bash .claude/skills/test-sandbox/scripts/bootstrap-empty.sh picker-smoke
echo -e "1\n1" | (cd sandbox/picker-smoke && deno run --allow-all ../../src/main.ts init --here --no-git)
```

Expected: stdin is non-TTY → numeric pickers run → both choose option `1` → init succeeds with
claude + local.

- [ ] **Step 5: Clean up**

```bash
bash .claude/skills/test-sandbox/scripts/clean.sh picker-smoke
```

---

### Task 10: Push, open PR, merge, and close issue #96

**Files:**

- None modified — release coordination only.

- [ ] **Step 1: Push the feature branch**

```bash
git push -u origin feat/interactive-picker
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(init): interactive arrow-key picker for harness + backlog prompts" --body "Closes #96.

Replace numeric \`Choose [1-N]\` prompts in \`specflow init\` with a hand-rolled radio-style picker driven by \`Deno.stdin.setRaw()\`. Zero new runtime deps. Non-TTY input keeps working via the existing numeric pickers (so \`echo 1 | specflow init\` still picks option 1).

## Test plan
- [x] \`deno task test\` — 365 passed
- [x] Manual smoke via test-sandbox — interactive picker, --ai/--backlog flags, piped numeric input

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 3: Watch CI**

```bash
gh pr checks --watch
```

Expected: all 4 checks (lint-test + 3× cross-smoke) green.

- [ ] **Step 4: Merge**

```bash
gh pr merge --squash --delete-branch
git checkout main && git pull --ff-only
```

- [ ] **Step 5: Dispatch the PO to close issue #96**

Dispatch the `product-owner` subagent with: "Close issue #96 with reason `completed`. Reference the
merged PR in the close comment." The PO handles the column move (In progress → Done) and the close.

---

## Self-Review

**1. Spec coverage:**

- Hand-rolled picker via `Deno.stdin.setRaw()` → Tasks 4 + 5 ✓
- Arrow keys / j-k navigation → Task 2 (parseKey) + Task 1 (nextIndex) ✓
- Space + Enter to select → Task 2 (parseKey 'select' branch) ✓
- Radio-style render → Task 3 (formatMenu) ✓
- Zero new runtime deps → only `@std/assert` (test-only, already present) used ✓
- Non-TTY fallback to numeric pickers → Task 8 (TTY guard branches) ✓
- Both prompts (harness + backlog backend) → Tasks 6 + 7 ✓
- Issue #96 closed at end → Task 10 ✓

**2. Placeholder scan:**

- No "TBD" / "TODO" / "implement later"
- Every code-touching step shows the actual code or exact diff
- Every test step shows the assertion code, not "write tests"

**3. Type consistency:**

- `SelectAction` literal union: defined Task 1, reused in Task 2 / Task 4 — consistent
- `SelectIO` shape: `write`, `readBytes`, `teardown` — same in Task 4 / Task 5 / Tasks 6 / 7
- `SelectItem<T>` with `key` + `label`: defined Task 4, used in Tasks 6 / 7 — consistent
- `pickHarnessInteractive(io)` / `pickBacklogBackendInteractive(io)` signatures match Task 8
  callsites
- `makeStdinSelectIO()` zero-arg in Task 5, called the same way in Task 8

No gaps found.
