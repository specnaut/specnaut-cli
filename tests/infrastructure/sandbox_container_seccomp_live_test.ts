import { assertEquals } from "@std/assert";
import type { BackendProbe, Engine } from "../../src/domain/sandbox.ts";
import { containerEngine } from "../../src/domain/sandbox_container.ts";
import { isPinned } from "../../src/domain/sandbox_image.ts";
import type { DenoProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { ContainerRunner } from "../../src/infrastructure/sandbox_runners.ts";
import { live, LIVE_IMAGE, probed, runIn, withLayout } from "./sandbox_live_fixture.ts";

/**
 * Inside a container on a real engine, under the CLI's own syscall profile: making a user
 * namespace fails (`unshare`, `clone` with CLONE_NEWUSER, `clone3`), and so does a vsock socket,
 * its family carried in the low 32 bits or not, beside a fork and a unix socket that succeed. One
 * call shows the profile in force is the CLI's and not the engine's default: `personality` with
 * ADDR_NO_RANDOMIZE, which both docker's and podman's default refuse and this profile allows. On
 * x86_64, an x32 call kills its process, as no architecture but the engine's own is filtered.
 *
 * Run on each engine this host offers a run (podman, docker, or both); skipped, saying why, where
 * none is, where SPECNAUT_LIVE_IMAGE names no digest-pinned image, or where that image has no
 * perl (the CI image's perl-base has it).
 */

/** The calls are made from perl's `syscall`: a shell has no way to make an arbitrary syscall. */
const PERL = "/usr/bin/perl";

/**
 * Each call's number on the container's machine: `unshare`, `clone`, `clone3`, `socket`,
 * `personality`. A failure prints its errno, a success `made`; a `clone` child exits at once.
 */
const SCRIPT = String.raw`
use strict; use POSIX ();
my %nr = (x86_64 => [272, 56, 435, 41, 135], aarch64 => [97, 220, 435, 198, 92]);
my ($unshare, $clone, $clone3, $socket, $personality) = @{$nr{(POSIX::uname())[4]}};
my ($newuser, $sigchld, $vsock) = (0x10000000, 17, 40);
$| = 1;
sub result { my $r = shift; return $r >= 0 ? "made" : $! + 0 }
sub child { my $r = shift; POSIX::_exit(0) if $r == 0; waitpid($r, 0) if $r > 0; return result($r) }
my $pid = fork(); POSIX::_exit(0) if $pid == 0; waitpid($pid, 0);
print "fork $?\n";
print "unix ", result(syscall($socket, 1, 1, 0)), "\n";
print "personality ", result(syscall($personality, 0x0040000)), "\n";
print "unshare ", result(syscall($unshare, $newuser)), "\n";
print "clone ", child(syscall($clone, $newuser | $sigchld, 0, 0, 0, 0)), "\n";
my $args = pack("Q11", $newuser, 0, 0, 0, $sigchld, 0, 0, 0, 0, 0, 0);
print "clone3 ", child(syscall($clone3, $args, 88)), "\n";
print "vsock ", result(syscall($socket, $vsock, 1, 0)), "\n";
print "vsock64 ", result(syscall($socket, (1 << 32) | $vsock, 1, 0)), "\n";
`;

/** A fork, a unix socket and `personality` succeed; the rest fail with EPERM, clone3 ENOSYS. */
const EXPECTED = [
  "fork 0",
  "unix made",
  "personality made",
  "unshare 1",
  "clone 1",
  "clone3 38",
  "vsock 1",
  "vsock64 1",
];

/** `getpid` as an x32 call, in a child: the signal that ended it (SIGSYS is 31), or 0. */
const X32 = String.raw`
use POSIX ();
my $pid = fork(); if ($pid == 0) { syscall(39 | 0x40000000); POSIX::_exit(0) }
waitpid($pid, 0); print "x32 ", $? & 127, "\n";
`;

/** `probe` with only `engine` there, so that a run is offered `engine` or nothing. */
function alone(engine: Engine): BackendProbe {
  return engine === "podman" ? { ...probed, docker: false } : { ...probed, podman: "absent" };
}

/** The engines this host offers a run, each on its own. */
const OFFERED = (["podman", "docker"] as const).filter((e) => containerEngine(alone(e)) === e);

/** What a live run on `engine` lacks here, or `null`. */
function missing(engine: Engine): string | null {
  if (!isPinned(LIVE_IMAGE)) return "a digest-pinned image, named in SPECNAUT_LIVE_IMAGE";
  const args = ["run", "--rm", "--pull", "never", "--network", "none", "--entrypoint", ""];
  const tried = new Deno.Command(engine, {
    args: [...args, LIVE_IMAGE, PERL, "-e", "1"],
    stdout: "null",
    stderr: "null",
  }).outputSync();
  return tried.success ? null : `${PERL} in the image named in SPECNAUT_LIVE_IMAGE`;
}

/** The lines `script` prints in a container on `engine`, its run having ended with 0. */
async function printed(engine: Engine, script: string): Promise<string[]> {
  let lines: string[] = [];
  await withLayout("container", async ({ policy }) => {
    const runner = (l: DenoProcessLauncher) =>
      new ContainerRunner(engine, LIVE_IMAGE, l, { dropped: [], cpus: null });
    const { outcome, out, err } = await runIn(runner, policy, [PERL, "-e", script]);
    assertEquals(outcome, { kind: "exited", code: 0 }, err);
    lines = out.trim().split("\n");
  });
  return lines;
}

if (OFFERED.length === 0) {
  Deno.test({
    name: live("container seccomp live: the CLI's profile in force", "podman or docker"),
    ignore: true,
    fn: () => {},
  });
}

for (const engine of OFFERED) {
  const lacking = missing(engine);
  Deno.test({
    name: live(`${engine} seccomp live: no user namespace or vsock, the CLI's profile`, lacking),
    ignore: lacking !== null,
    fn: async () => assertEquals(await printed(engine, SCRIPT), EXPECTED),
  });
  const arch = alone(engine)[engine === "podman" ? "podmanPlatform" : "dockerPlatform"].arch;
  const x32 = lacking ?? (arch === "x86_64" ? null : `an x86_64 ${engine}, not ${arch}`);
  Deno.test({
    name: live(`${engine} seccomp live: an x32 call is killed with SIGSYS`, x32),
    ignore: x32 !== null,
    fn: async () => assertEquals(await printed(engine, X32), ["x32 31"]),
  });
}
