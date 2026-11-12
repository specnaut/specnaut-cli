import { LOG_CAP_BYTES, LogFilter } from "../domain/inert_log.ts";

/**
 * A sandboxed run's output file (`inert_log.ts`): created new, so nothing already at the path, a
 * link included, is written through; both of the run's streams write into it through one filter,
 * in the order their chunks arrive. `close` adds a last line when the cap cut the output.
 */
export type CappedLog = {
  readonly out: WritableStream<Uint8Array>;
  readonly err: WritableStream<Uint8Array>;
  close(): Promise<void>;
};

export async function openCappedLog(path: string, cap = LOG_CAP_BYTES): Promise<CappedLog> {
  const file = await Deno.open(path, { write: true, createNew: true, mode: 0o600 });
  const filter = new LogFilter(cap);
  let pending: Promise<unknown> = Promise.resolve();
  const write = (chunk: Uint8Array) => {
    const kept = filter.push(chunk);
    pending = pending.then(() => kept.length > 0 ? writeAll(file, kept) : undefined);
    return pending.then(() => undefined);
  };
  const stream = () => new WritableStream<Uint8Array>({ write });
  return {
    out: stream(),
    err: stream(),
    close: async () => {
      await pending;
      if (filter.truncated) {
        await writeAll(file, new TextEncoder().encode(`\n[output cut at ${cap} bytes]\n`));
      }
      file.close();
    },
  };
}

async function writeAll(file: Deno.FsFile, bytes: Uint8Array): Promise<void> {
  for (let at = 0; at < bytes.length;) at += await file.write(bytes.subarray(at));
}
