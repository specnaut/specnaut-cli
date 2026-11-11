// cli#762 — `Test-OwnedDirectory`'s Windows branch, the only one that reads an
// ACL, run where it can run: the windows-latest CI job. The POSIX branch is
// repo_root_twins_test.ts's, through a `.specnaut` borrowed from `/`.
//
// Accepted: a directory whose owner is set to this account, whatever owner the
// runner's token would have given it (an elevated account's files belong to the
// Administrators group). Refused: the Windows directory, whose owner is the
// system's own (TrustedInstaller), which no account here can hand a directory
// without a privilege a hosted runner does not grant. The row checks that owner
// first, so a runner image that changed it fails here instead of passing blind.

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { guardPowerShellArm, PWSH_AVAILABLE } from "./pwsh_arm.ts";
import { results, SCRIPTS, twins } from "./twin_runner.ts";

const WINDOWS = Deno.build.os === "windows";

guardPowerShellArm();

const body = (mine: string) => `
$sid = [System.Security.Principal.SecurityIdentifier]
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$security = [System.Security.AccessControl.DirectorySecurity]::new()
$security.SetOwner($me)
[System.IO.FileSystemAclExtensions]::SetAccessControl([System.IO.DirectoryInfo]::new('${mine}'), $security)
"RESULT mine owner is me=$(((Get-Acl -LiteralPath '${mine}').GetOwner($sid) -eq $me).ToString().ToLower())"
"RESULT mine=$("$(Test-OwnedDirectory '${mine}')".ToLower())"
$owner = (Get-Acl -LiteralPath $env:SystemRoot).GetOwner($sid)
"RESULT system owner is foreign=$("$(($owner -ne $me) -and ($owner.Value -ne 'S-1-5-32-544'))".ToLower())"
"RESULT system=$("$(Test-OwnedDirectory $env:SystemRoot)".ToLower())"
`;

Deno.test({
  name:
    "owned directory [pwsh, Windows]: this account's directory is accepted, the system's refused",
  ignore: !WINDOWS || !PWSH_AVAILABLE,
  fn: async () => {
    const tmp = await Deno.realPath(await Deno.makeTempDir({ prefix: "owned-dir-" }));
    try {
      const mine = join(tmp, "mine");
      await Deno.mkdir(mine);
      const r = await twins(false)[0].functions(SCRIPTS, { bash: "", pwsh: body(mine) }, tmp);
      assertEquals(results(r), [
        "mine owner is me=true",
        "mine=true",
        "system owner is foreign=true",
        "system=false",
      ], `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
});
