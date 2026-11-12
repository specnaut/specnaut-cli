/**
 * What a sandboxed run's output becomes before anyone reads it: a file the review briefs by path,
 * never text pasted into a session. Every control byte but tab and line feed is dropped (C0, DEL,
 * and C1 as UTF-8 spells it, `C2 80`..`C2 9F`), so no escape sequence or carriage return reaches a
 * terminal or a reader; and the bytes kept stop at a cap, so a run cannot fill the disk. The run's
 * result is its exit code, never anything read here.
 */

/** The most bytes a run's log keeps: enough for any gate's report, far below a disk's worth. */
export const LOG_CAP_BYTES = 4 * 1024 * 1024;

const TAB = 0x09, LF = 0x0a, DEL = 0x7f, C1_LEAD = 0xc2;

export class LogFilter {
  #kept = 0;
  #lead = false;
  #truncated = false;

  constructor(readonly cap: number = LOG_CAP_BYTES) {}

  /** Whether bytes were dropped at the cap. */
  get truncated(): boolean {
    return this.#truncated;
  }

  /** The bytes of `chunk` to keep, given every chunk before it. */
  push(chunk: Uint8Array): Uint8Array {
    const out: number[] = [];
    for (const byte of chunk) this.#take(byte, out);
    const room = Math.max(0, this.cap - this.#kept);
    if (out.length > room) this.#truncated = true;
    const kept = out.slice(0, room);
    this.#kept += kept.length;
    return Uint8Array.from(kept);
  }

  /** A lead byte `C2` is held until the next byte says whether it starts a C1 control. */
  #take(byte: number, out: number[]): void {
    if (this.#lead) {
      this.#lead = false;
      if (byte >= 0x80 && byte <= 0x9f) return;
      out.push(C1_LEAD);
    }
    if (byte === C1_LEAD) this.#lead = true;
    else if ((byte < 0x20 && byte !== TAB && byte !== LF) || byte === DEL) return;
    else out.push(byte);
  }
}
