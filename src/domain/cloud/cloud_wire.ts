// What every Cloud HTTP client reads off a response, in one place: which statuses
// mean "unavailable", and what counts as a JSON object body. No client imports
// another for these.

/** Cloud could not be reached (0) or failed itself (5xx): the one rule for "retrying may help". */
export function isUnavailableStatus(status: number): boolean {
  return status === 0 || status >= 500;
}

/** A JSON value when it is an object, else null: the one rule every client's body reading uses. */
export function jsonObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * The body as an object; a body that is anything else (no JSON, `null`, an array, a
 * primitive) reads as `{}`. A connection dropped mid-body rejects: an outage is not
 * an empty answer.
 */
export async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return jsonObject(JSON.parse(text)) ?? {};
  } catch (e) {
    if (e instanceof SyntaxError) return {};
    throw e;
  }
}
