// What every Cloud HTTP client reads off a response, in one place: which statuses
// mean "unavailable" or "redirected", what counts as a JSON object body, and how a
// server value is made safe to use. No client imports another for these.
//
// The redirect rule (cli#736): no Cloud request follows a redirect. Each one carries
// a token, and many a body, and `api_url` is the only host anyone vetted; a 307 would
// re-send that body elsewhere. The API contract has no redirects, and the cloud
// scripts ask curl for none. In these clients a 3xx therefore reads as its own
// failure, never as an outage: retrying changes nothing.

/** The one wording for that failure, wherever it surfaces. */
export const REDIRECT_REFUSED =
  "Specnaut Cloud redirected the request, and the CLI follows no redirect: check the API URL";

/** Send a Cloud request: the one place a client reaches `fetch`, so none can follow a redirect. */
export function cloudFetch(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  return fetchFn(url, { ...init, redirect: "manual" });
}

/** Cloud answered with a redirect, which no client follows. */
export function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

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

/** A string field of a body, safe to print, or null. */
export function strField(json: Record<string, unknown>, key: string): string | null {
  const v = json[key];
  return typeof v === "string" ? cleanText(v) : null;
}

/** Coerce a server value to a string with control / non-printable characters
 *  stripped, C1 included, so hostile or misconfigured API output can't inject
 *  terminal escape sequences (ANSI / OSC) when the CLI prints org names, board
 *  column names, task titles or an error (#398 hardening). */
export function cleanText(v: unknown): string {
  // deno-lint-ignore no-control-regex
  return String(v ?? "").replace(/[\x00-\x1f\x7f-\x9f]/g, "");
}

/** Clamp a (possibly NaN) number into [lo, hi], falling back to lo. */
export function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
