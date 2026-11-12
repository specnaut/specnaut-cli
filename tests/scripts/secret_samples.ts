/**
 * The synthetic values every check built on `_report_text.sh`'s `scan_hard` is
 * proven against, by class, and the texts it must let through. One list: a
 * second copy in a test would keep passing whatever the scan does.
 *
 * Every value is assembled at run time: this repository is public, and these
 * are the shapes a secret scanner looks for. None is a real credential.
 */

const fill = (n: number) => "a".repeat(n);

/** Refused as `secret`: a known token shape, a credential assignment, a scheme value. */
export const SECRET_SAMPLES: readonly string[] = [
  `ghp_${fill(36)}`,
  `gho_${fill(36)}`,
  `ghu_${fill(36)}`,
  `ghs_${fill(36)}`,
  `ghr_${fill(36)}`,
  `github_pat_${fill(82)}`,
  `gl${"pat"}-${fill(20)}`,
  `sk-${"ant"}-api03-${fill(93)}`,
  `sk-${"ant"}-short`,
  `sk-${fill(48)}`,
  `AK${"IA"}IOSFODNN7EXAMPLE`,
  `AS${"IA"}IOSFODNN7EXAMPLE`,
  `sk_${"live"}_${fill(24)}`,
  `rk_${"live"}_${fill(24)}`,
  `xo${"xb"}-1234-abcd`,
  `npm_${fill(36)}`,
  `AI${"za"}${fill(35)}`,
  `ey${"J"}hbGciOiJI.eyJzdWIiOiIx.c2lnbmF0dXJl`,
  `-----BEGIN ${"PRIVATE"} KEY-----`,
  `https://someone:hunter2@example.com/x`,
  `Bearer abcdefgh12345`,
  `bearer abcdefgh12345`,
  `Authorization: x`,
  `Authorization= x`,
  `glft-${fill(20)}`,
  `wh${"sec"}_${fill(24)}`,
  `sk_${"test"}_${fill(24)}`,
  `py${"pi"}-${fill(24)}`,
  `h${"f"}_${fill(24)}`,
  `S${"G"}.${fill(24)}`,
  `sh${"pat"}_${fill(24)}`,
  `dop_${"v1"}_${fill(24)}`,
  `ya${"29"}.${fill(24)}`,
  `xa${"pp"}-1-${fill(24)}`,
  `dckr_${"pat"}_${fill(24)}`,
  `password=plainwords1234`,
  `secret=plainwords1234`,
  `PASSWD: plainwords1234`,
  `"password": "plainwords1234"`,
  `client-secret=plainwords1234`,
  `my_token = plainwords1234`,
  `api_key: plainwords1234`,
  `access-key=plainwords1234`,
  `credentials: plainwords1234`,
  `"Authorization": "Basic abcdefgh1234"`,
  `Basic dXNlcjpwYXNz1`,
  `Cookie: a=b`,
  `x-api-key: abc`,
];

/**
 * In SECRET_SAMPLES, but refused only in the scan's strict mode: a header or an
 * assignment whose value is no token. Text bound for Cloud lets them through.
 */
export const NAMED_ONLY: readonly string[] = [
  "Authorization: x",
  "Authorization= x",
  "x-api-key: abc",
];

/** What a spec about authentication says: the scan refuses it, text bound for Cloud does not. */
export const AUTH_PROSE: readonly string[] = [
  "Authorization: Bearer <token>",
  "Send the Cookie: header with each call",
  "token: required",
  // Only the value is judged, not the words after it.
  "token: required for every v2 call",
  "secret: rotation",
  "Set api_key: yourkeyhere in the config",
];

/** A header or an assignment with a value shaped like a token: refused in both modes. */
export const TOKEN_VALUED: readonly string[] = [
  `Authori${"zation"}: abc123XYZ987`,
  `Coo${"kie"}: sid=9f8e7d6c5b4a`,
  `x-api-${"key"}: AbC123xyz789`,
  `tok${"en"}: ghx9Kq2mZp7L`,
  // A harmless first assignment does not hide a second one.
  `secret: rotation, then pass${"word"}=plainwords1234`,
];

/**
 * Refused as `hidden`: a control or invisible character, an HTML comment, a
 * link-reference definition. The second holds a NUL, which no argv can carry:
 * it reaches a script only as a file or on stdin.
 */
export const HIDDEN_SAMPLES: readonly string[] = [
  "a\u0001b",
  "a\u0000b",
  "\u001b[31mred",
  "zero\u200bwidth",
  "a\u00adb",
  "right\u202eleft",
  "iso\u2066late",
  "tag\u{e0041}char",
  "\ufeffbom",
  "<!-- a note for the reader -->",
  "\n[ref]: https://example.com/x\n",
  "\n  [ref]: x\n",
  "a\ufe00b",
  "a\ufe0eb",
  "a\ufff9b",
  "a\ufffbb",
  "a\u3164b",
  "a\uffa0b",
  "a\u115fb",
  "a\u1160b",
  "a\u034fb",
  "a\u17b4b",
  "a\u17b5b",
  "a\u180bb",
  "a\u180db",
];

/** Variable names the scan treats as secret-bearing: any text holding their value is refused `secret`. */
export const SECRET_NAMES: readonly string[] = [
  "ACME_TOKEN",
  "my_api_key",
  "DB_SECRET",
  "SMTP_PASSWORD",
  "DB_PASS",
  "SERVICE_CRED",
  "SENTRY_DSN",
];

/** A value that is refused only because a variable named like a secret holds it. */
export const ENV_VALUE = "plainwords1234";

/** What must pass: prose that only resembles a secret, hashes, links, non-ASCII letters. */
export const SURVIVORS: readonly string[] = [
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "task-name-long-enough-to-look-like-a-key-abcdefghijk",
  "risk_live",
  "A Bearer token was rejected",
  "/specnaut issue",
  "https://specnaut.com/docs",
  "https://github.com/specnaut/specnaut-cli/issues/12",
  "https://example.com/x",
  "v10.0.0.1",
  "caf\u00e9 \u2014 ok \u{1f600}",
  "\u2764\ufe0f",
  "global-config-file-missing",
  "/opt/homebrew/bin/gh",
  "foo.io:12:3",
  "src/foo.io",
  "settings.local.json",
  ".env.local",
  "1.2.dev",
  "github.com",
  "specnaut.com/version.json",
  "token: <redacted>",
  "token: missing",
  "basic functionality",
  "A [link](https://specnaut.com) inline",
];

/** A clean multi-line body: Markdown, a tab, non-ASCII letters, inner newlines, no trailing one. */
export const CLEAN_BODY =
  "## Summary\n\nThe caf\u00e9 export times out after **30 s**.\n\n- step\tone\n- `code` and [a link](https://example.com/x)";

/** A clean one-line title. */
export const CLEAN_TITLE = "Caf\u00e9 export times out on large boards";
