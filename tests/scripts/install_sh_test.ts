import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { UNREADABLE_OK } from "./twin_runner.ts";
import { ignore, inSandbox, install, stubLog } from "./install_sh_sandbox.ts";

/**
 * cli#816 — `install.sh` with an explicit PREFIX that does not exist yet, as the documented
 * `PREFIX=$HOME/.local/bin` line meets it on a fresh machine. The folder's nearest existing parent
 * is the user's, so it is created as the user: no sudo, which would leave a root-owned folder in the
 * home, or abort when refused. The sandbox (`install_sh_sandbox.ts`) serves a fake release; its
 * sudo logs every call and refuses it.
 *
 * cli#825 — the walk up to that parent ends where `dirname` returns its input, and the binary's
 * mode is set before any move, so no chmod runs as root on what the move left at PREFIX.
 */

Deno.test({
  name: "install.sh creates an explicit, missing PREFIX under HOME as the user, never with sudo",
  ignore,
  fn: () =>
    inSandbox({}, async (s) => {
      const prefix = join(s.home, ".local/bin");
      const { code, out } = await install(s, { PREFIX: prefix });
      assertEquals(code, 0, out);
      assertStringIncludes(out, `installed ${join(prefix, "specnaut")}`);
      assertStringIncludes(out, "specnaut 9.9.9");
      assert(!out.includes("admin access"), out); // the line printed before sudo is tried
      assertEquals(await stubLog(s, "sudo"), "", "sudo was called");
      assertEquals((await Deno.stat(join(prefix, "specnaut"))).mode! & 0o777, 0o755);
      assertEquals(await Array.fromAsync(Deno.readDir(s.tmp)), [], "the download folder was left");
      assertStringIncludes(out, `${prefix} is not in your PATH`);
    }),
});

Deno.test({
  name: "install.sh still asks for admin access when the user cannot create PREFIX",
  ignore: !UNREADABLE_OK, // root writes every folder, so never needs sudo for one
  fn: () =>
    inSandbox({}, async (s) => {
      const locked = join(s.home, "locked");
      await Deno.mkdir(locked, { mode: 0o555 });
      try {
        const { code, out } = await install(s, { PREFIX: join(locked, "bin") });
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
  ignore,
  fn: () =>
    inSandbox({ summed: "not the binary" }, async (s) => {
      const { code, out } = await install(s);
      assertEquals(code, 1, out);
      assertStringIncludes(out, "checksum mismatch");
      assert(!out.includes("installed"), out);
      assertEquals(await stubLog(s, "gh"), "", "the attestation was checked after a bad checksum");
      assertEquals(await Array.fromAsync(Deno.readDir(s.tmp)), [], "the download folder was left");
    }),
});

Deno.test({
  name: "install.sh says so when the latest version cannot be resolved",
  ignore,
  fn: () =>
    inSandbox({}, async (s) => {
      const { code, out } = await install(s, { SPECNAUT_VERSION: "" });
      assertEquals(code, 1, out);
      assertStringIncludes(out, "could not resolve latest version from GitHub");
    }),
});

Deno.test({
  name: "install.sh asks curl for HTTPS and TLS 1.2 on every download",
  ignore,
  fn: () =>
    inSandbox({}, async (s) => {
      const { code, out } = await install(s);
      assertEquals(code, 0, out);
      const calls = (await stubLog(s, "curl")).trim().split("\n");
      assertEquals(calls.length, 3, "binary, checksum, bundle"); // the version was pinned
      for (const call of calls) assertStringIncludes(call, "--proto =https --tlsv1.2 ");
    }),
});

Deno.test({
  name: "install.sh exits through sudo on a relative PREFIX run from an unsearchable folder",
  ignore: !UNREADABLE_OK, // root searches every folder, so never meets the end of the walk
  fn: () =>
    inSandbox({}, async (s) => {
      const dark = join(s.home, "dark");
      await Deno.mkdir(dark);
      // A spawn cannot start in a folder it cannot search: bash enters it, then closes it.
      const enter = ["-c", 'cd "$1" && chmod 600 . && exec /bin/bash "$2"', "_", dark, s.script];
      try {
        const { code, out } = await install(s, { PREFIX: "rel/bin" }, enter);
        assertEquals(code, 1, out); // the stub sudo refuses, and PREFIX was set explicitly
        assertStringIncludes(out, "rel/bin requires admin access");
      } finally {
        await Deno.chmod(dark, 0o755);
      }
    }),
});

Deno.test({
  name: "install.sh sets the mode before the sudo move and runs no chmod as root",
  ignore: !UNREADABLE_OK, // root writes every folder, so never needs sudo for one
  fn: async () => {
    const locked = await Deno.makeTempDir({ prefix: "install-sh-locked-" });
    await Deno.chmod(locked, 0o555);
    try {
      await inSandbox({ sudoWrites: locked }, async (s) => {
        const { code, out } = await install(s, { PREFIX: locked });
        assertEquals(code, 0, out);
        assertStringIncludes(out, `${locked} requires admin access`);
        assertEquals((await Deno.stat(join(locked, "specnaut"))).mode! & 0o777, 0o755);
        const sudo = (await stubLog(s, "sudo")).trim().split("\n");
        assert(sudo.some((call) => call.startsWith("mv -f ")), sudo.join("\n"));
        assert(!sudo.some((call) => call.includes("chmod")), sudo.join("\n"));
      });
    } finally {
      await Deno.chmod(locked, 0o755);
      await Deno.remove(locked, { recursive: true });
    }
  },
});

/**
 * Whether the user may write the default PREFIX, or the nearest folder above it that exists. When
 * so, a run with PREFIX unset would install into the host's own /usr/local/bin.
 */
const defaultPrefixWritable = !ignore && new Deno.Command("/bin/sh", {
  args: ["-c", 'd=/usr/local/bin; while [ ! -e "$d" ]; do d=$(dirname "$d"); done; [ -w "$d" ]'],
}).outputSync().success;

Deno.test({
  name: "install.sh falls back to ~/.local/bin, mode 755, when sudo is refused for the default",
  ignore: !UNREADABLE_OK || defaultPrefixWritable, // only a refused default reaches the fallback
  fn: () =>
    inSandbox({}, async (s) => {
      const { code, out } = await install(s, { PREFIX: "" }); // unset: the default
      assertEquals(code, 0, out);
      const fallback = join(s.home, ".local/bin");
      assertStringIncludes(out, `installed to ${fallback} instead of /usr/local/bin`);
      assertEquals((await Deno.stat(join(fallback, "specnaut"))).mode! & 0o777, 0o755);
    }),
});
