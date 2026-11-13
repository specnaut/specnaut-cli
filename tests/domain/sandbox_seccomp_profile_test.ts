import { assert, assertEquals, assertThrows } from "@std/assert";
import { containerArgs } from "../../src/domain/sandbox_args.ts";
import { AF_VSOCK, DENIED_SYSCALLS } from "../../src/domain/sandbox_seccomp.ts";
import {
  CLONE_NAMESPACE_FLAGS,
  type ProfileRule,
  seccompProfile,
} from "../../src/domain/sandbox_seccomp_profile.ts";
import { after, policyOf, runOf, SECCOMP } from "./sandbox_fixture.ts";

/**
 * The syscall filter a container run carries as its own: an OCI seccomp profile in the format
 * docker and podman read. Its verdict for a call is worked out here as libseccomp would reach it
 * (a rule's conditions all hold, any matching rule refuses), so it is checked on any host.
 */

const EPERM = 1;
const ENOSYS = 38;
const AF_UNIX = 1;
const AF_INET = 2;
const SIGCHLD = 17;
/** What glibc's `pthread_create` passes to `clone`. */
const THREAD = 0x3d0f00;
/** What glibc's `fork` passes to `clone`. */
const FORK = 0x1200000 | SIGCHLD;
const CLONE_NEWUSER = 0x10000000;
const CLONE_NEWNET = 0x40000000;

/** The errno a call to `name` with arguments `args` fails with, or `null` where it is allowed. */
function refusal(name: string, args: readonly number[] = []): number | null {
  const rules = seccompProfile().syscalls.filter((r) => r.names.includes(name) && holds(r, args));
  return rules.length === 0 ? null : rules[0].errnoRet;
}

function holds(rule: ProfileRule, args: readonly number[]): boolean {
  return (rule.args ?? []).every(({ index, value, valueTwo, op }) => {
    const arg = BigInt(args[index] ?? 0);
    if (op === "SCMP_CMP_EQ") return arg === BigInt(value);
    return (arg & BigInt(value)) === BigInt(valueTwo);
  });
}

Deno.test("seccompProfile: every call is allowed but those refused below", () => {
  const profile = seccompProfile();
  assertEquals(profile.defaultAction, "SCMP_ACT_ALLOW");
  assert(profile.syscalls.every((r) => r.action === "SCMP_ACT_ERRNO"));
  for (const name of ["read", "openat", "execve", "wait4", "ptrace"]) {
    assertEquals(refusal(name), null, name);
  }
});

Deno.test("seccompProfile: every call bubblewrap's filter denies is refused with EPERM", () => {
  const unconditional = seccompProfile().syscalls.filter((r) => r.args === undefined);
  const denied = unconditional.filter((r) => r.errnoRet === EPERM).flatMap((r) => r.names);
  assertEquals(denied, [...DENIED_SYSCALLS]);
  for (const name of ["unshare", "setns", "keyctl", "bpf", "io_uring_setup", "userfaultfd"]) {
    assertEquals(refusal(name), EPERM, name);
  }
});

Deno.test("seccompProfile: clone with any namespace flag is refused, a thread or a fork is not", () => {
  assertEquals(refusal("clone", [THREAD]), null);
  assertEquals(refusal("clone", [FORK]), null);
  assertEquals(refusal("clone", [CLONE_NEWUSER | SIGCHLD]), EPERM);
  assertEquals(refusal("clone", [CLONE_NEWNET | FORK]), EPERM);
  for (const flag of Object.values(CLONE_NAMESPACE_FLAGS)) {
    assertEquals(refusal("clone", [flag | SIGCHLD]), EPERM, flag.toString(16));
  }
});

Deno.test("seccompProfile: clone's namespace flags are the kernel's, and never its exit signal", () => {
  const flags: Record<string, number> = CLONE_NAMESPACE_FLAGS;
  assertEquals(flags, {
    CLONE_NEWNS: 0x00020000,
    CLONE_NEWCGROUP: 0x02000000,
    CLONE_NEWUTS: 0x04000000,
    CLONE_NEWIPC: 0x08000000,
    CLONE_NEWUSER: 0x10000000,
    CLONE_NEWPID: 0x20000000,
    CLONE_NEWNET: 0x40000000,
  });
  // CLONE_NEWTIME (0x80) lies in clone's exit-signal byte: no signal may be refused for it.
  for (let signal = 0; signal < 0x100; signal++) assertEquals(refusal("clone", [signal]), null);
});

Deno.test("seccompProfile: clone3 fails with ENOSYS, so a C library falls back to clone", () => {
  assertEquals(refusal("clone3", [0, 88]), ENOSYS);
});

Deno.test("seccompProfile: a vsock socket is refused with EPERM; other families are not", () => {
  assertEquals(refusal("socket", [AF_VSOCK, 1, 0]), EPERM);
  assertEquals(refusal("socket", [AF_UNIX, 1, 0]), null);
  assertEquals(refusal("socket", [AF_INET, 1, 0]), null);
});

Deno.test("seccompProfile: names no architecture, so the engine's own is the only one filtered", () => {
  const profile = seccompProfile() as Record<string, unknown>;
  assertEquals(Object.keys(profile).sort(), ["defaultAction", "syscalls"]);
});

const RUN = runOf(`ghcr.io/acme/dev@sha256:${"b".repeat(64)}`, "specnaut-gate-1");
const COMMAND = ["deno", "task", "test"];

Deno.test("containerArgs: on either engine, the run carries the CLI's own syscall profile", () => {
  for (const engine of ["docker", "podman"] as const) {
    const args = containerArgs(policyOf("container"), { ...RUN, engine }, COMMAND);
    assertEquals(after(args, "--security-opt").filter((o) => o.startsWith("seccomp")), [
      `seccomp=${SECCOMP}`,
    ]);
  }
  for (const seccomp of ["", "unconfined", "seccomp.json", "/tmp/a,b.json", "/tmp/a\nb.json"]) {
    const run = { ...RUN, seccomp };
    assertThrows(() => containerArgs(policyOf("container"), run, COMMAND), Error, "", seccomp);
  }
});
