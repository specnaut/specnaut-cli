export type SelectAction = "up" | "down" | "select" | "cancel" | "noop";

export type SelectItem<T> = { key: T; label: string };

export type SelectIO = {
  write(s: string): void;
  readBytes(): Promise<Uint8Array | null>;
  teardown(): void;
};

export function nextIndex(
  current: number,
  n: number,
  action: SelectAction,
): number {
  if (action === "up") return (current - 1 + n) % n;
  if (action === "down") return (current + 1) % n;
  return current;
}

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

/**
 * Run an interactive radio-style picker. Returns the chosen item's key,
 * or `null` if the user cancelled (Ctrl-C / ESC / q / EOF).
 *
 * Render strategy: write the frame, then on every keypress write
 * `\x1b[<n>A` to move the cursor back up `n` lines (where n = total lines
 * in the previous frame), then `\x1b[J` to clear from the cursor to
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
  // Rewind by the frame's ACTUAL physical height, not an assumed
  // `labels.length + 1`. A header that itself spans multiple lines (embedded
  // "\n") would otherwise leave the cursor-up count short, so each redraw
  // drifts downward and the menu "scrolls" instead of updating in place. The
  // height is constant across redraws (only the ❯ position moves).
  const totalLines = formatMenu(labels, current, header).split("\n").length;

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
