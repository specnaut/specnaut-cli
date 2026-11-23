/**
 * The syscall filter a container run carries as its own: an OCI seccomp profile, in the format
 * docker and podman read from `--security-opt seccomp=<file>` (`containerArgs`). Passed with each
 * run, it replaces whatever profile the engine would apply by default, so neither a containers.conf
 * `seccomp_profile` nor a daemon.json `seccomp-profile` can weaken or remove it.
 *
 * Layered as "allow, but these", like bubblewrap's filter, and built from the same list and values
 * (`DENIED_SYSCALLS`, `AF_VSOCK`, `PERSONALITY_ALLOWED`), so the two refuse the same calls, the
 * same socket family and the same persona flags. The values are shared, not how an argument is
 * compared: each filter does that its own way, and both read the argument as the kernel does, its
 * low 32 bits. It is not built on the engine's default profile: that default is
 * the engine's to change, and an allow-list copied here would be a second list to keep current
 * with every kernel. The calls the engine's default refuses and this profile allows are, in the
 * main, ones the run's dropped capabilities already refuse.
 *
 * What bubblewrap gets from `--disable-userns`, a container gets here: `unshare` and `setns` are
 * on the shared list, `clone` with any namespace flag is refused, and `clone3`, whose flags lie
 * behind a pointer no filter reads, fails with ENOSYS, on which a C library falls back to `clone`.
 *
 * No architecture is named: the engine then filters its own only, and libseccomp kills a call made
 * under any other (32-bit, or x32 on x86_64), as bubblewrap's filter does. A name an architecture
 * lacks (`iopl` on aarch64) is skipped by the runtime, as in the engines' own profiles.
 *
 * A name the OCI runtime's libseccomp does not know is skipped the same way. It is the runtime's
 * library that decides (runc's or crun's, as the engine runs it), not the host's nor the engine's.
 * Every rule is added name by name, so the skip reaches any rule: the denied list, the `clone3`
 * ENOSYS rule, and the argument rules on `clone`, `socket` and `personality`. runc logs the skip at
 * debug level only, so a run says nothing; crun warns, and fails instead only under an annotation
 * (`run.oci.seccomp_fail_unknown_syscall`) a run does not set. Behind an older runtime library the
 * list in force is shorter than this one. The newest calls are the likely ones: `open_tree_attr`
 * (Linux 6.15) first, then `set_mempolicy_home_node` (5.17), `quotactl_fd` (5.14) and
 * `mount_setattr` (5.12). Such a call is allowed where the kernel has it, and fails with ENOSYS
 * where it does not. Bubblewrap's filter names each call by its number, not through libseccomp, so
 * it has no such gap.
 *
 * `personality` is held to the values the engines' default profiles allow it: one rule per flag
 * outside `PERSONALITY_ALLOWED` (`PER_LINUX32 | UNAME26`), so `0`, `8`, `0x20000` and `0x20008`
 * pass and any other persona or flag (no ASLR, read-implies-exec, page zero mapped) is refused. A
 * rule's conditions on one argument are split by the runtime into rules of their own, OR-ed
 * (runc), so "only these values" cannot be one rule; and the engines' extra allowance, the
 * read-only query `0xffffffff`, has every flag set and is refused too: stricter than the engines.
 * The tools that ask it (sanitizer runtimes, a debugger disabling randomisation) take the -1 as
 * "cannot" and carry on.
 *
 * A call newer than these lists is allowed: the default action is ALLOW, on purpose. An allow-list
 * would refuse every call a newer kernel or C library adds before this file names it, breaking
 * builds on the newest systems first, and would be a second list of every syscall to keep current.
 * The calls that reach the whole host or other processes are named instead, as above.
 *
 * Pure: the caller writes it to a file.
 */

import { AF_VSOCK, DENIED_SYSCALLS, EPERM, PERSONALITY_ALLOWED } from "./sandbox_syscalls.ts";

/** `clone3` fails as on a kernel without it: the one errno a C library falls back on. */
const ENOSYS = 38;

/**
 * The low 32 bits of an argument: `socket` reads its family as an `int`, so a rule comparing all
 * 64 would let `(1 << 32) | AF_VSOCK` past it to a vsock socket.
 */
const INT = 0xffffffff;

/**
 * The flags with which `clone` makes a namespace. CLONE_NEWTIME (0x80) is not one: `clone` reads
 * that bit as part of the child's exit signal, and only `clone3` and `unshare` take it.
 */
export const CLONE_NAMESPACE_FLAGS = {
  CLONE_NEWNS: 0x00020000,
  CLONE_NEWCGROUP: 0x02000000,
  CLONE_NEWUTS: 0x04000000,
  CLONE_NEWIPC: 0x08000000,
  CLONE_NEWUSER: 0x10000000,
  CLONE_NEWPID: 0x20000000,
  CLONE_NEWNET: 0x40000000,
} as const;

/** Every other bit of `personality`'s 32-bit argument, each refused by a rule of its own. */
const PERSONALITY_REFUSED_FLAGS: readonly number[] = Array.from(
  { length: 32 },
  (_, b) => 2 ** b,
)
  .filter((bit) => (PERSONALITY_ALLOWED & bit) === 0);

export type ProfileArg = {
  readonly index: number;
  readonly value: number;
  readonly valueTwo: number;
  readonly op: "SCMP_CMP_MASKED_EQ";
};

/** One rule: its calls fail with `errnoRet` when every one of its `args` holds. */
export type ProfileRule = {
  readonly names: readonly string[];
  readonly action: "SCMP_ACT_ERRNO";
  readonly errnoRet: number;
  readonly args?: readonly ProfileArg[];
};

export type SeccompProfile = {
  readonly defaultAction: "SCMP_ACT_ALLOW";
  readonly syscalls: readonly ProfileRule[];
};

/**
 * The profile. A rule's conditions must all hold, and any rule that matches refuses, so `clone`
 * takes one rule per flag: `(flags & flag) == flag` for each.
 */
export function seccompProfile(): SeccompProfile {
  return {
    defaultAction: "SCMP_ACT_ALLOW",
    syscalls: [
      refused([...DENIED_SYSCALLS], EPERM),
      ...Object.values(CLONE_NAMESPACE_FLAGS).map((flag) =>
        refused(["clone"], EPERM, [firstArg(flag, flag)])
      ),
      refused(["clone3"], ENOSYS),
      refused(["socket"], EPERM, [firstArg(INT, AF_VSOCK)]),
      ...PERSONALITY_REFUSED_FLAGS.map((flag) =>
        refused(["personality"], EPERM, [firstArg(flag, flag)])
      ),
    ],
  };
}

function refused(names: string[], errnoRet: number, args?: ProfileArg[]): ProfileRule {
  const rule = { names, action: "SCMP_ACT_ERRNO", errnoRet } as const;
  return args === undefined ? rule : { ...rule, args };
}

/** A condition on the call's first argument: masked by `value`, it equals `valueTwo`. */
function firstArg(value: number, valueTwo: number): ProfileArg {
  return { index: 0, value, valueTwo, op: "SCMP_CMP_MASKED_EQ" };
}
