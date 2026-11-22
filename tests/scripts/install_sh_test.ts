import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { encodeHex } from "@std/encoding/hex";
import { fromFileUrl, join } from "@std/path";
import { UNREADABLE_OK } from "./twin_runner.ts";

/**
 * cli#816 — `install.sh` with an explicit PREFIX that does not exist yet, as the documented
 * `PREFIX=$HOME/.local/bin` line meets it on a fresh machine. The folder's nearest existing parent
 * is the user's, so it is created as the user: no sudo, which would leave a root-owned folder in the
 * home, or abort when refused. `curl` and `sudo` are stubs on PATH: curl serves a fake release
 * binary and its checksum, sudo logs every call and refuses it.
 */

const INSTALL = fromFileUrl(new URL("../../install.sh", import.meta.url));
const BINARY = '#!/bin/sh\necho "specnaut 9.9.9"\n';

/** A folder holding the `curl` and `sudo` stubs, the files curl serves and sudo's log. */
async function stubs(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "install-sh-stubs-" });
  const sha = encodeHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(BINARY)));
  await Deno.writeTextFile(join(dir, "fake"), BINARY);
  await Deno.writeTextFile(join(dir, "fake.sha256"), `${sha}  specnaut\n`);
  const curl = `#!/bin/sh
out="" url=""
while [ $# -gt 0 ]; do case $1 in -o) out=$2; shift ;; -*) ;; *) url=$1 ;; esac; shift; done
case $url in *.sha256) cp '${dir}/fake.sha256' "$out" ;; *) cp '${dir}/fake' "$out" ;; esac
`;
  const sudo = `#!/bin/sh\nprintf '%s\\n' "$*" >>'${dir}/sudo.log'\nexit 1\n`;
  for (const [name, text] of [["curl", curl], ["sudo", sudo]]) {
    await Deno.writeTextFile(join(dir, name), text);
    await Deno.chmod(join(dir, name), 0o755);
  }
  return dir;
}

/** install.sh run with `prefix` and nothing of this process's environment: its output and code. */
async function install(bin: string, home: string, prefix: string, tmp: string) {
  const { code, stdout, stderr } = await new Deno.Command("bash", {
    args: [INSTALL],
    clearEnv: true,
    env: { HOME: home, PATH: `${bin}:/usr/bin:/bin`, PREFIX: prefix, TMPDIR: tmp, VERSION: "v9" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { code, out: new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr) };
}

const tempDir = (prefix: string) => Deno.makeTempDir({ prefix: `install-sh-${prefix}-` });

Deno.test({
  name: "install.sh creates an explicit, missing PREFIX under HOME as the user, never with sudo",
  ignore: Deno.build.os === "windows", // install.sh refuses Windows
  fn: async () => {
    const [bin, home, tmp] = [await stubs(), await tempDir("home"), await tempDir("tmp")];
    const prefix = join(home, ".local/bin");
    const { code, out } = await install(bin, home, prefix, tmp);
    assertEquals(code, 0, out);
    assertStringIncludes(out, `installed ${join(prefix, "specnaut")}`);
    assertStringIncludes(out, "specnaut 9.9.9");
    assert(!out.includes("admin access"), out); // the line printed before sudo is tried
    const log = await Deno.readTextFile(join(bin, "sudo.log")).catch((e) => {
      if (e instanceof Deno.errors.NotFound) return "";
      throw e;
    });
    assertEquals(log, "", "sudo was called");
    assertEquals((await Deno.stat(join(prefix, "specnaut"))).mode! & 0o777, 0o755);
    assertEquals(await Array.fromAsync(Deno.readDir(tmp)), [], "the download folder was left");
  },
});

Deno.test({
  name: "install.sh still asks for admin access when the user cannot create PREFIX",
  ignore: !UNREADABLE_OK, // root writes every folder, so never needs sudo for one
  fn: async () => {
    const [bin, home, tmp] = [await stubs(), await tempDir("home"), await tempDir("tmp")];
    const locked = join(home, "locked");
    await Deno.mkdir(locked, { mode: 0o555 });
    try {
      const { code, out } = await install(bin, home, join(locked, "bin"), tmp);
      assertEquals(code, 1, out); // the stub sudo refuses, and PREFIX was set explicitly
      assertStringIncludes(out, `${join(locked, "bin")} requires admin access`);
      assert(!out.includes("could not create"), out);
    } finally {
      await Deno.chmod(locked, 0o755);
    }
  },
});
