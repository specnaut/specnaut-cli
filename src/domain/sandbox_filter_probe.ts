/**
 * What a container run reports of its syscall filter: the names of the CLI's profile
 * (`seccompProfile`) the OCI runtime put in force, as a probe sees them from inside a container
 * started like the run's, and the names it dropped. The profile is name-only, and a runtime whose
 * libseccomp does not know a name skips that rule, saying nothing a run sees; so the record is
 * what the probe observed, never what the profile asks.
 *
 * The probe (`probeElf`) first adds a filter of its own ({@link probeFilter}) that answers each
 * probed call with SECCOMP_RET_TRACE. With no tracer attached, the kernel then fails the call with
 * ENOSYS and never runs it, so the probe has no effect whatever the profile holds. Of two filters,
 * the kernel takes the stronger action, and the profile's ERRNO outranks TRACE: a call the
 * profile refuses fails with the profile's errno, one it dropped with ENOSYS. The one refusal
 * that is ENOSYS itself, `clone3`'s, is not traced: it is made with a size of 0, which the kernel
 * refuses (EINVAL) before it reads anything, so only the profile's ENOSYS reads as applied. On a
 * kernel without `clone3` the call fails with ENOSYS either way, as the rule intends.
 *
 * Each name is probed once, with its first rule's argument: `clone` with a namespace flag,
 * `socket` with the vsock family, `personality` with a refused flag. A name the machine lacks
 * (`iopl` on aarch64) is not probed: no runtime can apply it there.
 *
 * Pure: the caller runs the probe and hands its output to {@link readProbe}.
 */

import { encode, type Insn, insn } from "./sandbox_seccomp.ts";
import { seccompProfile } from "./sandbox_seccomp_profile.ts";
import {
  CLONE_NUMBERS,
  type FilterArch,
  PERSONALITY_NUMBERS,
  SOCKET_NUMBERS,
  SYSCALL_NUMBERS,
} from "./sandbox_syscalls.ts";

/** One probed call: its name and number, its first two arguments, the errno the profile sets. */
export type ProbeCall = {
  readonly name: string;
  readonly nr: number;
  readonly args: readonly [number, number];
  readonly refusal: number;
  /** Answered by the probe's own filter, so the kernel never runs it (see the file's comment). */
  readonly traced: boolean;
};

/** What a container run observed of its filter, or why it could not. */
export type FilterRecord =
  | {
    readonly kind: "observed";
    /** The profile's names the probe saw refused with the profile's errno, in the profile's order. */
    readonly applied: readonly string[];
    /** The profile's names the probe saw pass the profile: the runtime dropped them. */
    readonly dropped: readonly string[];
  }
  | { readonly kind: "unobserved"; readonly why: string };

const ENOSYS = 38;
/** `socket`'s second argument: a stream socket, the kind a vsock connection opens. */
const SOCK_STREAM = 1;
/** One byte per call: its errno's low six bits past `0`, so every answer is printable ASCII. */
const DIGIT_ZERO = 0x30;
const SIX_BITS = 0x3f;

/** The calls probed on `arch`: each name of the profile once, in its order. */
export function probeCalls(arch: FilterArch): ProbeCall[] {
  const calls = new Map<string, ProbeCall>();
  for (const rule of seccompProfile().syscalls) {
    const first = rule.args?.[0]?.valueTwo ?? 0;
    for (const name of rule.names) {
      const nr = numberOf(arch, name);
      if (nr === undefined || calls.has(name)) continue;
      const args = [first, name === "socket" ? SOCK_STREAM : 0] as const;
      const traced = rule.errnoRet !== ENOSYS;
      calls.set(name, { name, nr, args, refusal: rule.errnoRet, traced });
    }
  }
  return [...calls.values()];
}

function numberOf(arch: FilterArch, name: string): number | undefined {
  const numbers: Readonly<Record<string, number | undefined>> = {
    ...SYSCALL_NUMBERS[arch],
    ...CLONE_NUMBERS[arch],
    socket: SOCKET_NUMBERS[arch],
    personality: PERSONALITY_NUMBERS[arch],
  };
  return numbers[name];
}

const LD_NR = 0x20;
const JEQ_K = 0x15;
const RET_K = 0x06;
const RET_TRACE = 0x7ff00000;
const RET_ALLOW = 0x7fff0000;

/** The probe's own filter: TRACE each traced call's number, allow the rest. */
export function probeFilter(calls: readonly ProbeCall[]): Uint8Array {
  const traced = [...new Set(calls.filter((c) => c.traced).map((c) => c.nr))];
  if (traced.length > 255) throw new Error("the probe's filter's jump is out of range");
  const tests: Insn[] = traced.map((k, i) => ({ code: JEQ_K, jt: traced.length - i, jf: 0, k }));
  return encode([insn(LD_NR, 0), ...tests, insn(RET_K, RET_ALLOW), insn(RET_K, RET_TRACE)]);
}

/** The byte the probe prints for a call that failed with `errno`. */
export function answerOf(errno: number): string {
  return String.fromCharCode(DIGIT_ZERO + (errno & SIX_BITS));
}

/**
 * The record of a probe that exited `code` having printed `printed`: a call answered with its
 * refusal's byte is applied, any other answer dropped. A probe that failed, or printed other than
 * one byte per call, is unobserved: nothing is inferred from it.
 */
export function readProbe(
  calls: readonly ProbeCall[],
  printed: string,
  code: number,
): FilterRecord {
  if (code !== 0) return { kind: "unobserved", why: `the filter probe exited ${code}` };
  if (printed.length !== calls.length) {
    const what = `${printed.length} answers to ${calls.length} calls`;
    return { kind: "unobserved", why: `the filter probe printed ${what}` };
  }
  const held = calls.map((call, i) => printed[i] === answerOf(call.refusal));
  return {
    kind: "observed",
    applied: calls.filter((_, i) => held[i]).map((c) => c.name),
    dropped: calls.filter((_, i) => !held[i]).map((c) => c.name),
  };
}
