/**
 * The syscall filter bubblewrap loads (`--seccomp`) just before it runs a branch's gates: a classic
 * BPF program over the kernel's `struct seccomp_data`, built here as bytes. It narrows the kernel
 * the sandbox can reach to what a build or a test uses: a call that mounts, enters a namespace or
 * makes one with `unshare`, touches a kernel keyring, loads a module or a BPF program, or acts on
 * the whole host fails with EPERM, so a tool that probes for it carries on. `clone` and `clone3`
 * are not filtered, whatever their flags (`clone3` passes them behind a pointer no filter reads):
 * a new namespace needs a capability the sandbox drops, or a user namespace, which bubblewrap's
 * `--disable-userns` forbids (`bwrapArgs`). A call made under another architecture
 * (32-bit, or x32 on x86_64) would reach the same kernel under other numbers, so it is refused too.
 * One socket family is refused as well: vsock, which a network namespace does not isolate, and
 * which reaches the hypervisor or the host from a virtual machine.
 *
 * {@link DENIED_SYSCALLS} and {@link AF_VSOCK} also build the container backend's profile
 * (`sandbox_seccomp_profile.ts`): one list, so the two backends refuse the same calls.
 *
 * Pure: the launcher hands the bytes to bubblewrap on {@link SECCOMP_FD}.
 */

export type FilterArch = "x86_64" | "aarch64";

/** The file descriptor bubblewrap reads the program from: the first past the standard streams. */
export const SECCOMP_FD = 3;

/** The calls refused with EPERM. `ptrace` is not among them: the PID namespace bounds it. */
export const DENIED_SYSCALLS = [
  // Mounting, and entering or making a namespace.
  ...["mount", "umount2", "pivot_root", "unshare", "setns", "mount_setattr", "open_tree"],
  ...["move_mount", "fsopen", "fsconfig", "fsmount", "fspick"],
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
  },
};

/** `socket`'s number: its first argument, the address family, is what the vsock rule reads. */
export const SOCKET_NUMBERS: Readonly<Record<FilterArch, number>> = { x86_64: 41, aarch64: 198 };

/** The vsock address family: no network namespace holds it. */
export const AF_VSOCK = 40;

/** `AUDIT_ARCH_*`: the value the kernel puts in `seccomp_data.arch` for a native call. */
const AUDIT_ARCH: Readonly<Record<FilterArch, number>> = {
  x86_64: 0xc000003e,
  aarch64: 0xc00000b7,
};

/** On x86_64 an x32 call carries this bit in its number. */
const X32_SYSCALL_BIT = 0x40000000;

const LD_W_ABS = 0x20;
const JEQ_K = 0x15;
const JGE_K = 0x35;
const RET_K = 0x06;
const RET_KILL_PROCESS = 0x80000000;
const RET_ERRNO = 0x00050000;
const RET_ALLOW = 0x7fff0000;
/**
 * The errno a refusal fails with, so a tool that probes for a call carries on: every refusal of
 * bubblewrap's filter, and every one of the container's profile but `clone3`'s, which is ENOSYS.
 */
export const EPERM = 1;
/**
 * `seccomp_data`: the call's number, its architecture, then (past the instruction pointer) its
 * arguments, 64 bits each, the low half first on both little-endian architectures.
 */
const NR_OFFSET = 0;
const ARCH_OFFSET = 4;
const ARG0_OFFSET = 16;

export function isFilterArch(arch: string): arch is FilterArch {
  return Object.hasOwn(AUDIT_ARCH, arch);
}

type Insn = { code: number; jt: number; jf: number; k: number };

/**
 * The program for `arch`: kill a call made under any other architecture; then refuse each denied
 * number (and, on x86_64, every x32 number) with EPERM, and `socket` when its family is vsock;
 * allow the rest. Every refusal jumps to the one EPERM return at the end.
 */
export function seccompFilter(arch: FilterArch): Uint8Array {
  if (!isFilterArch(arch)) throw new Error(`no syscall filter for ${arch}`);
  const denied = DENIED_SYSCALLS.flatMap((n) => SYSCALL_NUMBERS[arch][n] ?? []);
  const head: Insn[] = [
    insn(LD_W_ABS, ARCH_OFFSET),
    { code: JEQ_K, jt: 1, jf: 0, k: AUDIT_ARCH[arch] },
    insn(RET_K, RET_KILL_PROCESS),
    insn(LD_W_ABS, NR_OFFSET),
  ];
  const tests = [
    ...(arch === "x86_64" ? [{ code: JGE_K, k: X32_SYSCALL_BIT }] : []),
    ...denied.map((k) => ({ code: JEQ_K, k })),
  ];
  const vsock = vsockRule(arch);
  // From test i, the EPERM return sits past the remaining tests, the vsock rule and ALLOW.
  const body = tests.map((t, i) => ({ ...t, jt: jump(tests.length - i + vsock.length), jf: 0 }));
  const end = [insn(RET_K, RET_ALLOW), insn(RET_K, RET_ERRNO | EPERM)];
  return encode([...head, ...body, ...vsock, ...end]);
}

/** Not `socket`: on to ALLOW. `socket`: load its family; vsock jumps over ALLOW to EPERM. */
function vsockRule(arch: FilterArch): Insn[] {
  return [
    { code: JEQ_K, jt: 0, jf: 2, k: SOCKET_NUMBERS[arch] },
    insn(LD_W_ABS, ARG0_OFFSET),
    { code: JEQ_K, jt: 1, jf: 0, k: AF_VSOCK },
  ];
}

function insn(code: number, k: number): Insn {
  return { code, jt: 0, jf: 0, k };
}

/** A conditional jump is one byte: a longer one would wrap to another instruction. */
function jump(offset: number): number {
  if (offset > 255) throw new Error("the syscall filter's jump is out of range");
  return offset;
}

/** `struct sock_filter[]` in the byte order of both architectures: little-endian. */
function encode(program: readonly Insn[]): Uint8Array {
  const out = new Uint8Array(program.length * 8);
  const view = new DataView(out.buffer);
  program.forEach(({ code, jt, jf, k }, i) => {
    view.setUint16(i * 8, code, true);
    view.setUint8(i * 8 + 2, jt);
    view.setUint8(i * 8 + 3, jf);
    view.setUint32(i * 8 + 4, k >>> 0, true);
  });
  return out;
}
