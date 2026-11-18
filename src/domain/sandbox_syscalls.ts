/**
 * What both sandbox backends refuse a branch's gates, and the kernel's numbers for it: the calls
 * refused with EPERM ({@link DENIED_SYSCALLS}), the socket family ({@link AF_VSOCK}) and the
 * persona flags ({@link PERSONALITY_ALLOWED}). Bubblewrap's filter (`sandbox_seccomp.ts`) refuses
 * them by number, the container profile (`sandbox_seccomp_profile.ts`) by name: one list and one
 * set of values, so the two backends refuse the same calls, and `personality` the same values.
 *
 * Each number is the kernel's own: `arch/x86/entry/syscalls/syscall_64.tbl` for x86_64,
 * `arch/arm64/tools/syscall_64.tbl` for aarch64.
 *
 * Pure data.
 */

export type FilterArch = "x86_64" | "aarch64";

/** The calls refused with EPERM. `ptrace` is not among them: the PID namespace bounds it. */
export const DENIED_SYSCALLS = [
  // Mounting, and entering or making a namespace.
  ...["mount", "umount2", "pivot_root", "unshare", "setns", "mount_setattr", "open_tree"],
  ...["open_tree_attr", "move_mount", "fsopen", "fsconfig", "fsmount", "fspick"],
  // Kernel keyrings, modules, kexec.
  ...["add_key", "request_key", "keyctl", "init_module", "finit_module", "delete_module"],
  ...["kexec_load", "kexec_file_load"],
  // The whole host: power, swap, accounting, clock, kernel log, quotas, the terminal.
  ...["reboot", "swapon", "swapoff", "acct", "settimeofday", "clock_settime", "syslog"],
  ...["quotactl", "quotactl_fd", "vhangup", "nfsservctl", "lookup_dcookie"],
  // Kernel surfaces no build needs: BPF, perf, userfaultfd, io_uring, handles, other processes'
  // pages.
  ...["bpf", "perf_event_open", "userfaultfd", "io_uring_setup", "io_uring_enter"],
  ...["io_uring_register", "name_to_handle_at", "open_by_handle_at", "move_pages"],
  "migrate_pages",
  // Comparing other processes' kernel objects, watching the whole filesystem, and the memory
  // placement policy: a build needs none, and the engines' default profiles refuse them too.
  ...["kcmp", "fanotify_init", "mbind", "set_mempolicy", "get_mempolicy"],
  "set_mempolicy_home_node",
  // Ports and the old library loader, on x86_64 only.
  ...["iopl", "ioperm", "uselib"],
] as const;

type Denied = typeof DENIED_SYSCALLS[number];

/** The calls numbered from 424 up share their number on every architecture. */
const UNIFIED = {
  io_uring_setup: 425,
  io_uring_enter: 426,
  io_uring_register: 427,
  open_tree: 428,
  move_mount: 429,
  fsopen: 430,
  fsconfig: 431,
  fsmount: 432,
  fspick: 433,
  mount_setattr: 442,
  quotactl_fd: 443,
  set_mempolicy_home_node: 450,
  open_tree_attr: 467,
} as const;

/** Each denied call's number, per architecture; a call an architecture lacks is absent. */
export const SYSCALL_NUMBERS: Readonly<Record<FilterArch, Partial<Record<Denied, number>>>> = {
  x86_64: {
    ...UNIFIED,
    ...{ mount: 165, umount2: 166, pivot_root: 155, unshare: 272, setns: 308 },
    ...{ add_key: 248, request_key: 249, keyctl: 250, init_module: 175, finit_module: 313 },
    ...{ delete_module: 176, kexec_load: 246, kexec_file_load: 320, reboot: 169, swapon: 167 },
    ...{ swapoff: 168, acct: 163, settimeofday: 164, clock_settime: 227, syslog: 103 },
    ...{ quotactl: 179, vhangup: 153, nfsservctl: 180, lookup_dcookie: 212, bpf: 321 },
    ...{ perf_event_open: 298, userfaultfd: 323, name_to_handle_at: 303 },
    ...{ open_by_handle_at: 304, move_pages: 279, migrate_pages: 256 },
    ...{ kcmp: 312, fanotify_init: 300, mbind: 237, set_mempolicy: 238, get_mempolicy: 239 },
    ...{ iopl: 172, ioperm: 173, uselib: 134 },
  },
  aarch64: {
    ...UNIFIED,
    ...{ mount: 40, umount2: 39, pivot_root: 41, unshare: 97, setns: 268 },
    ...{ add_key: 217, request_key: 218, keyctl: 219, init_module: 105, finit_module: 273 },
    ...{ delete_module: 106, kexec_load: 104, kexec_file_load: 294, reboot: 142, swapon: 224 },
    ...{ swapoff: 225, acct: 89, settimeofday: 170, clock_settime: 112, syslog: 116 },
    ...{ quotactl: 60, vhangup: 58, nfsservctl: 42, lookup_dcookie: 18, bpf: 280 },
    ...{ perf_event_open: 241, userfaultfd: 282, name_to_handle_at: 264 },
    ...{ open_by_handle_at: 265, move_pages: 239, migrate_pages: 238 },
    ...{ kcmp: 272, fanotify_init: 262, mbind: 235, set_mempolicy: 237, get_mempolicy: 236 },
  },
};

/** `socket`'s number: its first argument, the address family, is what the vsock rule reads. */
export const SOCKET_NUMBERS: Readonly<Record<FilterArch, number>> = { x86_64: 41, aarch64: 198 };

/** `personality`'s number: its first argument, the persona, is what the persona rule reads. */
export const PERSONALITY_NUMBERS: Readonly<Record<FilterArch, number>> = {
  x86_64: 135,
  aarch64: 92,
};

/** The vsock address family: no network namespace holds it. */
export const AF_VSOCK = 40;

/**
 * The persona flags `personality` may carry, those the engines' default profiles allow:
 * PER_LINUX32 (8) and UNAME26 (0x20000), so `0`, `8`, `0x20000` and `0x20008`. Any other flag (no
 * ASLR, read-implies-exec, page zero mapped) is refused, and so is the read-only query
 * `0xffffffff`, which has every flag set: the tools that ask it take the -1 as "cannot".
 */
export const PERSONALITY_ALLOWED = 0x20008;

/**
 * The errno a refusal fails with, so a tool that probes for a call carries on: every refusal of
 * bubblewrap's filter, and every one of the container's profile but `clone3`'s, which is ENOSYS.
 */
export const EPERM = 1;
