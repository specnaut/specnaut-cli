import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { encodeHex } from "@std/encoding/hex";
import { fromFileUrl, join } from "@std/path";
import { UNREADABLE_OK } from "./twin_runner.ts";

/**
 * cli#816 — `install.sh` with an explicit PREFIX that does not exist yet, as the documented
 * `PREFIX=$HOME/.local/bin` line meets it on a fresh machine. The folder's nearest existing parent
 * is the user's, so it is created as the user: no sudo, which would leave a root-owned folder in the
 * home, or abort when refused. `curl` and `sudo` are stubs on PATH: curl serves a fake release
 * binary and its checksum, sudo logs every call and refuses it. Every case runs in temporary
 * folders it removes.
 */

const INSTALL = fromFileUrl(new URL("../../install.sh", import.meta.url));
const BINARY = '#!/bin/sh\necho "specnaut 9.9.9"\n';

/**
 * A folder holding the `curl` and `sudo` stubs, the files curl serves and sudo's log. The checksum
 * served is that of `summed`, the binary's own unless a case says otherwise.
 */
async function stubs(summed: string): Promise<string> {
  const dir = await tempDir("stubs");
  const sha = encodeHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(summed)));
  await Deno.writeTextFile(join(dir, "fake"), BINARY);
  await Deno.writeTextFile(join(dir, "fake.sha256"), `${sha}  specnaut\n`);
  const curl = `#!/bin/sh
out="" url=""
while [ $# -gt 0 ]; do case $1 in -o) out=$2; shift ;; -*) ;; *) url=$1 ;; esac; shift; done
case $url in *.sha256) f='${dir}/fake.sha256' ;; *) f='${dir}/fake' ;; esac
if [ -n "$out" ]; then cp "$f" "$out"; else cat "$f"; fi
`;
  const sudo = `#!/bin/sh\nprintf '%s\\n' "$*" >>'${dir}/sudo.log'\nexit 1\n`;
  for (const [name, text] of [["curl", curl], ["sudo", sudo]]) {
    await Deno.writeTextFile(join(dir, name), text);
    await Deno.chmod(join(dir, name), 0o755);
  }
  return dir;
}

/** install.sh run with `prefix` and nothing of this process's environment: its output and code. */
async function install(bin: string, home: string, prefix: string, tmp: string, version = "v9") {
  const { code, stdout, stderr } = await new Deno.Command("bash", {
    args: [INSTALL],
    cwd: home,
    clearEnv: true,
    env: {
      HOME: home,
      PATH: `${bin}:/usr/bin:/bin`,
      PREFIX: prefix,
      TMPDIR: tmp,
      ...version ? { VERSION: version } : {},
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { code, out: new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr) };
}

function tempDir(prefix: string): Promise<string> {
  return Deno.makeTempDir({ prefix: `install-sh-${prefix}-` });
}

/** `fn` given the stubs, a HOME and a TMPDIR, all three removed after it, whatever it did. */
async function inFolders(
  fn: (bin: string, home: string, tmp: string) => Promise<void>,
  summed = BINARY,
): Promise<void> {
  const [bin, home, tmp] = [await stubs(summed), await tempDir("home"), await tempDir("tmp")];
  try {
    await fn(bin, home, tmp);
  } finally {
    for (const dir of [bin, home, tmp]) await Deno.remove(dir, { recursive: true });
  }
}

Deno.test({
  name: "install.sh creates an explicit, missing PREFIX under HOME as the user, never with sudo",
  ignore: Deno.build.os === "windows", // install.sh refuses Windows
  fn: () =>
    inFolders(async (bin, home, tmp) => {
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
      assertStringIncludes(out, `${prefix} is not in your PATH`);
    }),
});

Deno.test({
  name: "install.sh still asks for admin access when the user cannot create PREFIX",
  ignore: !UNREADABLE_OK, // root writes every folder, so never needs sudo for one
  fn: () =>
    inFolders(async (bin, home, tmp) => {
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
    }),
});

Deno.test({
  name: "install.sh installs nothing when the checksum does not match the binary",
  ignore: Deno.build.os === "windows",
  fn: () =>
    inFolders(async (bin, home, tmp) => {
      const prefix = join(home, ".local/bin");
      const { code, out } = await install(bin, home, prefix, tmp);
      assertEquals(code, 1, out);
      assertStringIncludes(out, "checksum mismatch");
      assert(!out.includes("installed"), out);
      assertEquals(await Array.fromAsync(Deno.readDir(tmp)), [], "the download folder was left");
    }, "not the binary"),
});

Deno.test({
  name: "install.sh says so when the latest version cannot be resolved",
  ignore: Deno.build.os === "windows",
  fn: () =>
    inFolders(async (bin, home, tmp) => {
      const { code, out } = await install(bin, home, join(home, "bin"), tmp, "");
      assertEquals(code, 1, out);
      assertStringIncludes(out, "could not resolve latest version from GitHub");
    }),
});
