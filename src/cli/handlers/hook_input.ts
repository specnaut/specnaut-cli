/**
 * A Claude Code hook's input: the JSON the harness writes on the hook's stdin. Read here once for
 * every command a hook runs, bounded, and parsed without a throw for input that is not JSON.
 */

/** The most bytes of hook input read: far above any payload the harness sends. */
export const MAX_INPUT_BYTES = 1024 * 1024;

/** The input as JSON, or `undefined`: the caller refuses either way the payload is not one. */
export function parsedInput(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    // Not swallowed: an input that is not JSON is refused as a usage error by the caller.
    if (!(err instanceof SyntaxError)) throw err;
    return undefined;
  }
}

/** stdin, whole, or `null` when it is a terminal; over {@link MAX_INPUT_BYTES} is a throw. */
export async function readHookInput(): Promise<string | null> {
  if (Deno.stdin.isTerminal()) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of Deno.stdin.readable) {
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) throw new Error(`the input is over ${MAX_INPUT_BYTES} bytes`);
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return new TextDecoder().decode(bytes);
}
