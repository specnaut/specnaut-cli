/** git's output as text: the one decode its adapters share, and the first line of an answer. */
export const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

export const firstLine = (bytes: Uint8Array): string => decode(bytes).split("\n")[0];
