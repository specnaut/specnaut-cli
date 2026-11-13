import { assertEquals } from "@std/assert";
import type { Engine } from "../../src/domain/sandbox.ts";
import { containerEngine } from "../../src/domain/sandbox_container.ts";
import { isPinned } from "../../src/domain/sandbox_image.ts";
import type { DenoProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { ContainerRunner } from "../../src/infrastructure/sandbox_runners.ts";
import { live, LIVE_IMAGE, probed, runIn, withLayout } from "./sandbox_live_fixture.ts";

/**
 * Inside a container on a real engine, under the CLI's own syscall profile: making a user
 * namespace fails (`unshare`, `clone` with CLONE_NEWUSER, `clone3`), and so does a vsock socket,
 * beside a fork and a unix socket that succeed. On each engine this host would run on, docker and
 * podman alike; skipped, saying why, where an engine is not offered or the image named in
 * SPECNAUT_LIVE_IMAGE has no python3.
 */

/** The calls are made from python3: a shell has no way to make an arbitrary syscall. */
const PYTHON = "/usr/bin/python3";

/** Each call's number (`unshare`, `clone`, `clone3`) on the container's architecture. */
const SCRIPT = `
import ctypes, os, platform, socket
UNSHARE, CLONE, CLONE3 = {"x86_64": (272, 56, 435), "aarch64": (97, 220, 435)}[platform.machine()]
NEWUSER, SIGCHLD = 0x10000000, 17
c = ctypes.CDLL(None, use_errno=True)
long = ctypes.c_long
def errno(r):
    return "made" if r >= 0 else ctypes.get_errno()
def child(r):
    if r == 0:
        os._exit(0)
    if r > 0:
        os.waitpid(r, 0)
    return errno(r)
pid = os.fork()
if pid == 0:
    os._exit(0)
print("fork", os.waitpid(pid, 0)[1])
socket.socket(socket.AF_UNIX, socket.SOCK_STREAM).close()
print("unix opened")
print("unshare", errno(c.syscall(long(UNSHARE), long(NEWUSER))))
print("clone", child(c.syscall(long(CLONE), long(NEWUSER | SIGCHLD), long(0), long(0), long(0), long(0))))
args = (ctypes.c_uint64 * 11)()
args[0], args[4] = NEWUSER, SIGCHLD
print("clone3", child(c.syscall(long(CLONE3), ctypes.byref(args), long(88))))
try:
    socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM).close()
    print("vsock opened")
except OSError as e:
    print("vsock", e.errno)
`;

/** A fork and a unix socket succeed; the rest fail with EPERM, `clone3` with ENOSYS. */
const EXPECTED = ["fork 0", "unix opened", "unshare 1", "clone 1", "clone3 38", "vsock 1"];

/** What `engine` lacks to run this here, or `null`: it is the one a run would be offered. */
function missing(engine: Engine): string | null {
  const alone = engine === "podman" ? { docker: false } : { podman: "absent" as const };
  if (containerEngine({ ...probed, ...alone }) !== engine) return `${engine}, offered to a run`;
  if (!isPinned(LIVE_IMAGE)) return "a digest-pinned image, named in SPECNAUT_LIVE_IMAGE";
  const args = ["run", "--rm", "--pull", "never", "--network", "none", "--entrypoint", ""];
  const tried = new Deno.Command(engine, {
    args: [...args, LIVE_IMAGE, PYTHON, "-c", ""],
    stdout: "null",
    stderr: "null",
  }).outputSync();
  return tried.success ? null : `${PYTHON} in the image named in SPECNAUT_LIVE_IMAGE`;
}

for (const engine of ["podman", "docker"] as const) {
  const lacking = missing(engine);
  Deno.test({
    name: live(`${engine} live: no user namespace and no vsock inside, a fork runs`, lacking),
    ignore: lacking !== null,
    fn: () =>
      withLayout("container", async ({ policy }) => {
        const runner = (l: DenoProcessLauncher) =>
          new ContainerRunner(engine, LIVE_IMAGE, l, { dropped: [], cpus: null });
        const { outcome, out, err } = await runIn(runner, policy, [PYTHON, "-c", SCRIPT]);
        assertEquals(outcome, { kind: "exited", code: 0 }, err);
        assertEquals(out.trim().split("\n"), EXPECTED);
      }),
  });
}
