import { assertEquals } from "@std/assert";
import { CLOUD } from "./cloud_stub.ts";

/**
 * `cloud_send` writes a request body to a private file under the temporary
 * folder, hands curl its `@path`, and removes it when the request ends,
 * whether curl succeeded or failed: a body left behind is a tracker's text on
 * disk that nothing will clean.
 */

/**
 * Sources `_cloud_send.sh` with `cloud_curl` stood in by a function that says
 * whether the `@path` it was handed lies under TMPDIR and returns `rc`, then
 * lists what the send left in TMPDIR. TMPDIR is bash's own, so its path
 * compares in bash's spelling on every OS.
 */
const DRIVER = [
  "set -euo pipefail",
  "tmp=$(mktemp -d); export TMPDIR=$tmp",
  "trap 'rm -rf -- \"$tmp\"' EXIT",
  ". ./_cloud_send.sh",
  "cloud_curl() {",
  "  local f=${!#}",
  "  f=${f#@}",
  '  d=$(cd "$(dirname -- "$f")" && pwd -P); t=$(cd "$TMPDIR" && pwd -P)',
  '  case "$d/" in "$t"/*) echo "under=yes" ;; *) echo "under=no" ;; esac',
  '  echo "sent=$(cat -- "$f")"',
  '  return "$CURL_RC"',
  "}",
  "CURL_RC=$1",
  "rc=0; printf '{\"a\":1}' | cloud_send POST http://127.0.0.1:9/x || rc=$?",
  'echo "rc=$rc"',
  "echo \"left=$(ls -A \"$TMPDIR\" | tr '\\n' ' ')\"",
].join("\n");

async function send(rc: number): Promise<string[]> {
  const out = await new Deno.Command("bash", {
    args: ["-c", DRIVER, "driver", String(rc)],
    cwd: CLOUD,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const dec = new TextDecoder();
  return (dec.decode(out.stdout) + dec.decode(out.stderr)).trim().split("\n");
}

Deno.test("cloud_send hands curl a file under the temporary folder, removed once sent", async () => {
  assertEquals(await send(0), ["under=yes", 'sent={"a":1}', "rc=0", "left="]);
});

Deno.test("cloud_send removes the request body when the send fails", async () => {
  assertEquals(await send(7), ["under=yes", 'sent={"a":1}', "rc=7", "left="]);
});
