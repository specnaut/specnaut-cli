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
