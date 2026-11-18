import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { lfsBranch, lfsShim } from "./lfs_push_fixture.ts";

/**
 * cli#809 — what a failed `git lfs push` said reaches the merge phase's output, so every URL in it
 * keeps its scheme and host and nothing else: no list of parameter names to fall behind the next
 * signing scheme, encoding or path-borne token. And the push runs with git's and git-lfs's trace
 * variables cleared, which would print the request's Authorization header outright. The shim is a
 * bash script named `git` on PATH; Windows resolves `git.exe` first.
 */

const shimmed = { ignore: Deno.build.os === "windows" };

/** Each URL carries a secret, every one spelled `v-…`; the host after it is what stays. */
const URLS: ReadonlyArray<[string, string]> = [
  ["https://s3.example.test/b/o?AWSAccessKeyId=AK&Expires=1&Signature=v-sigv2", "s3.example.test"],
  ["https://cdn.example.test/o?Expires=1&Signature=v-cf&Key-Pair-Id=K", "cdn.example.test"],
  [
    "https://storage.example.test/b/o?X-Goog-Algorithm=A&X-Goog-Credential=v-gcred" +
    "&X-Goog-Signature=v-gsig",
    "storage.example.test",
  ],
  ["https://s3.example.test/o?X-Amz-Credential=v-acred&X-Amz-Signature=v-asig", "s3.example.test"],
  ["https://lfs.example.test/o?refresh_token=v-refresh", "lfs.example.test"],
  ["https://lfs.example.test/o?key=v-key&api_key=v-apikey&password=v-pass", "lfs.example.test"],
  ["https://lfs.example.test/o?a=1%26token%3Dv-pct", "lfs.example.test"],
  ["https://lfs.example.test/o?a=1&amp;token=v-amp", "lfs.example.test"],
  ["https://lfs.example.test/v-pathtoken/objects/batch", "lfs.example.test"],
  ["https://u:v-p@ss@lfs.example.test/x", "lfs.example.test"],
  ["HTTPS://v-only@lfs.example.test", "lfs.example.test"],
  ["https://v-tok:x-oauth-basic@lfs.example.test", "lfs.example.test"], // a token as the user name
  ["https://u:v-pw@lfs.example.test", "lfs.example.test"],
  ["https://lfs.example.test:8443/x", "lfs.example.test"], // the port goes with the rest
];

Deno.test(
  "lfs-push.sh: a failed push's URLs keep their scheme and host, nothing else",
  shimmed,
  async () => {
    const sb = await lfsBranch();
    try {
      const said = URLS.map(([url]) => `'denied: ${url} (retry)'`).join(" ");
      const fail = `printf '%s\\n' ${said} >&2; exit 2`;
      const r = await sb.scriptWithGit(
        lfsShim(join(sb.root, "git.log"), "git-lfs/3.0.0", fail),
        "lfs-push.sh",
      );
      assertEquals(r.code, 17, r.stderr);
      assertEquals(r.stderr.match(/v-[a-z]+/g), null, r.stderr);
      // Line for line: the host is the one after the userinfo's LAST `@`, not merely some host.
      const expected = URLS.map(([url, host]) => {
        const scheme = url.slice(0, url.indexOf("://"));
        const rest = url.slice(url.indexOf("://") + 3).includes("/") ? "/<redacted>" : "";
        return `denied: ${scheme}://${host}${rest} (retry)`;
      });
      assertEquals(r.stderr.split("\n").filter((l) => l.startsWith("denied: ")), expected);
    } finally {
      await sb.cleanup();
    }
  },
);

Deno.test(
  "lfs-push.sh: the push runs with no git or git-lfs trace variable set",
  shimmed,
  async () => {
    const sb = await lfsBranch();
    try {
      const traces = {
        GIT_TRACE: "1",
        GIT_TRACE_CURL: "1",
        GIT_CURL_VERBOSE: "1",
        GIT_TRANSFER_TRACE: "1",
        GIT_TRACE2: "1",
      };
      const said =
        'env | grep -E "^GIT_(TRACE|CURL_VERBOSE|TRANSFER_TRACE)" | sed "s/^/seen: /" >&2';
      const header = 'echo "> Authorization: Basic v-trace" >&2';
      const fail = `${said}; [ -z "\${GIT_CURL_VERBOSE:-}" ] || ${header}; exit 2`;
      const shim = lfsShim(join(sb.root, "git.log"), "git-lfs/3.0.0", fail);
      const r = await sb.scriptWithGitEnv(traces, shim, "lfs-push.sh");
      assertEquals(r.code, 17, r.stderr);
      assert(!r.stderr.includes("v-trace"), r.stderr);
      const seen = r.stderr.split("\n").filter((l) => l.startsWith("seen: "));
      assertEquals(seen, [], r.stderr);
    } finally {
      await sb.cleanup();
    }
  },
);
