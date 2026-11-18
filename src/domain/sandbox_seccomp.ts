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
 * which reaches the hypervisor or the host from a virtual machine. And `personality` takes only
 * the persona values {@link PERSONALITY_ALLOWED} names.
 *
 * What is refused, and each call's number, is `sandbox_syscalls.ts`'s, shared with the container
 * backend's profile (`sandbox_seccomp_profile.ts`); this file encodes it for bubblewrap.
 *
 * Pure: the launcher hands the bytes to bubblewrap on {@link SECCOMP_FD}.
 */

import {
  AF_VSOCK,
  DENIED_SYSCALLS,
  EPERM,
  type FilterArch,
  PERSONALITY_ALLOWED,
  PERSONALITY_NUMBERS,
  SOCKET_NUMBERS,
  SYSCALL_NUMBERS,
} from "./sandbox_syscalls.ts";

/** The file descriptor bubblewrap reads the program from: the first past the standard streams. */
export const SECCOMP_FD = 3;

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
const JSET_K = 0x45;
const RET_K = 0x06;
const RET_KILL_PROCESS = 0x80000000;
const RET_ERRNO = 0x00050000;
const RET_ALLOW = 0x7fff0000;
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
 * number (and, on x86_64, every x32 number) with EPERM, `socket` when its family is vsock, and
 * `personality` with a flag outside {@link PERSONALITY_ALLOWED}; allow the rest. Every refusal
 * jumps to the one EPERM return at the end.
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
  const args = argumentRules(arch);
  // From test i, the EPERM return sits past the remaining tests, the argument rules and ALLOW.
  const body = tests.map((t, i) => ({ ...t, jt: jump(tests.length - i + args.length), jf: 0 }));
  const end = [insn(RET_K, RET_ALLOW), insn(RET_K, RET_ERRNO | EPERM)];
  return encode([...head, ...body, ...args, ...end]);
}

/**
 * The rules that read a call's first argument, its low 32 bits (both calls read an `int`), three
 * instructions each. Another call: on to the next rule, its number still loaded. This call: load
 * the argument; a match jumps over the rules left and ALLOW to EPERM, anything else to ALLOW.
 */
function argumentRules(arch: FilterArch): Insn[] {
  const rules = [
    { nr: SOCKET_NUMBERS[arch], code: JEQ_K, k: AF_VSOCK },
    { nr: PERSONALITY_NUMBERS[arch], code: JSET_K, k: ~PERSONALITY_ALLOWED >>> 0 },
  ];
  return rules.flatMap(({ nr, code, k }, i) => {
    const toAllow = (rules.length - 1 - i) * 3;
    return [
      { code: JEQ_K, jt: 0, jf: 2, k: nr },
      insn(LD_W_ABS, ARG0_OFFSET),
      { code, jt: jump(toAllow + 1), jf: jump(toAllow), k },
    ];
  });
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
