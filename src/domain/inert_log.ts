/**
 * What a sandboxed run's output becomes before anyone reads it: a file the review briefs by path,
 * never text pasted into a session. Every control byte but tab and line feed is dropped (C0, DEL,
 * and C1 as UTF-8 spells it, `C2 80`..`C2 9F`), so no escape sequence or carriage return reaches a
 * terminal or a reader, judged on the decoded code points; and the bytes kept stop at a cap, so
 * a run cannot fill the disk. The run's result is its exit code, never anything read here.
 */

/** The most bytes a run's log keeps: enough for any gate's report, far below a disk's worth. */
export const LOG_CAP_BYTES = 4 * 1024 * 1024;

export class LogFilter {
  #kept = 0;
  #truncated = false;
  readonly #decoder = new TextDecoder("utf-8", { fatal: false });
  readonly #encoder = new TextEncoder();

  constructor(readonly cap: number = LOG_CAP_BYTES) {}

  /** Whether bytes were dropped at the cap. */
  get truncated(): boolean {
    return this.#truncated;
  }

  /**
   * The bytes of `chunk` to keep, given every chunk before it. The bytes are decoded as one
   * stream, so a control byte between a lead byte and its continuation cannot join them into a
   * control: every control is judged as a code point, and bytes that are no UTF-8 become U+FFFD.
   */
  push(chunk: Uint8Array): Uint8Array {
    return this.#keep(this.#decoder.decode(chunk, { stream: true }));
  }

  /** What a sequence cut at the end of the run leaves: U+FFFD, or nothing. */
  end(): Uint8Array {
    return this.#keep(this.#decoder.decode());
  }

  #keep(text: string): Uint8Array {
    const out = this.#encoder.encode(text.replace(CONTROLS, ""));
    const room = Math.max(0, this.cap - this.#kept);
    if (out.length > room) this.#truncated = true;
    const kept = out.slice(0, room);
    this.#kept += kept.length;
    return kept;
  }
}

/** C0 but tab and line feed, DEL, and C1. */
// deno-lint-ignore no-control-regex
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
