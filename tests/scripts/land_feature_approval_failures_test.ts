import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { git, SKIP_C } from "./git_sandbox.ts";
import { customisedBase, digest, landWithVerifier } from "./skill_approval_fixture.ts";

/**
 * How `land-feature.sh` fails once a yes held and the approvals are being recorded: a binary that
 * refuses the call is told from one too old for it, a base tip that is not a full sha is no answer,
 * and the temp file and index folder the recording makes are gone however it stops.
 */

const windows = Deno.build.os === "windows";

Deno.test("a binary that refuses the record-approvals call stops the landing: exit 12", {
  ignore: windows,
}, async () => {
  const sb = await customisedBase();
  try {
    const before = await git(sb.remote, "rev-parse", "main");
    // A binary that knows the command, handed arguments its parser refuses: exit 2.
    const refused = '[ "$1" = record-approvals ] && exec "$REAL" record-approvals --head x';
    const r = await landWithVerifier(sb, refused);
    assertEquals(r.code, 12, r.stderr);
    assertStringIncludes(r.stderr, "specnaut refused the arguments of record-approvals (exit 2)");
    assertEquals(r.stderr.includes("APPROVALS NOT RECORDED"), false, r.stderr);
    assertEquals(await git(sb.remote, "rev-parse", "main"), before);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a base tip that is not one full commit sha is no answer: exit 13", {
  ignore: windows,
}, async () => {
  const sb = await customisedBase();
  try {
    const before = await git(sb.remote, "rev-parse", "main");
    // An abbreviation git would resolve, and the binary's parser would refuse.
    const short = `if [ "$1" = verify-scripts ]; then
  "$REAL" "$@" | sed 's/^BASE_TIP \\(.......\\).*/BASE_TIP \\1/'; exit "\${PIPESTATUS[0]}"
fi`;
    const r = await landWithVerifier(sb, short);
    assertEquals(r.code, 13, r.stderr);
    assertStringIncludes(r.stderr, "land-feature: the verifier could not judge HEAD");
    assertEquals(await git(sb.remote, "rev-parse", "main"), before);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a failure while the approvals are committed leaves no temp file and no index", {
  ignore: windows,
}, async () => {
  const sb = await customisedBase();
  try {
    const tmp = join(sb.root, "tmp");
    await Deno.mkdir(tmp);
    const yes = await digest(sb);
    // Both exist when write-tree runs: the file the binary wrote, and the index folder.
    const shim = `${SKIP_C}[ "$sub" = write-tree ] && exit 1\nexec "$REAL_GIT" "$@"`;
    const args = ["--instructions-digest", yes];
    const r = await sb.scriptWithGitEnv({ TMPDIR: tmp }, shim, "land-feature.sh", ...args);
    assertEquals(r.code, 12, r.stderr);
    assertStringIncludes(r.stderr, "unexpected failure (exit 1) of:");
    assertEquals(await Array.fromAsync(Deno.readDir(tmp)), []);
  } finally {
    await sb.cleanup();
  }
});
