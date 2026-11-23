/**
 * The filter probe's machine code (`probeElf`), for each architecture the container profile is
 * checked on. Both run the same steps, with each machine's own syscall numbers:
 *
 *   prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)
 *   if prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &fprog) != 0: exit_group(2)
 *   for each call of the table: r = syscall(nr, arg0, arg1, 0, 0, 0)
 *                               byte = ((-r) & 0x3f) + '0'; write(1, &byte, 1)
 *   exit_group(0)
 *
 * `emit` takes where the `sock_fprog` and the table are, counted from the code's first byte, and
 * the number of calls. Pure data; the encodings are those an assembler gives the comments.
 */

import type { FilterArch } from "./sandbox_syscalls.ts";

export type ProbeCode = {
  readonly length: number;
  emit(fprog: number, table: number, count: number): Uint8Array;
};

const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

/** x86_64: prctl 157, write 1, exit_group 231. */
const X86_64: ProbeCode = {
  length: 0x9c,
  emit: (fprog, table, count) =>
    new Uint8Array([
      ...[0xb8, ...u32(157), 0xbf, ...u32(38), 0xbe, ...u32(1)], // mov eax/edi/esi
      ...[0x31, 0xd2, 0x45, 0x31, 0xd2, 0x45, 0x31, 0xc0, 0x0f, 0x05], // xor edx/r10d/r8d; syscall
      ...[0xb8, ...u32(157), 0xbf, ...u32(22), 0xbe, ...u32(2)], // mov eax/edi/esi
      ...[0x48, 0x8d, 0x15, ...u32(fprog - 0x2f), 0x0f, 0x05], // lea rdx, [rip+fprog]; syscall
      ...[0x48, 0x85, 0xc0, 0x75, 0x5a], // test rax, rax; jne fail
      ...[0x48, 0x8d, 0x1d, ...u32(table - 0x3d)], // lea rbx, [rip+table]
      ...[0x41, 0xbc, ...u32(count), 0x48, 0x83, 0xec, 0x10], // mov r12d, count; sub rsp, 16
      ...[0x48, 0x8b, 0x03, 0x48, 0x8b, 0x7b, 0x08, 0x48, 0x8b, 0x73, 0x10], // loop: rax/rdi/rsi
      ...[0x31, 0xd2, 0x45, 0x31, 0xd2, 0x45, 0x31, 0xc0, 0x45, 0x31, 0xc9], // xor edx..r9d
      ...[0x0f, 0x05, 0xf7, 0xd8, 0x83, 0xe0, 0x3f, 0x83, 0xc0, 0x30], // syscall; neg; and; add
      ...[0x88, 0x04, 0x24, 0xb8, ...u32(1), 0xbf, ...u32(1)], // mov [rsp], al; eax=1; edi=1
      ...[0x48, 0x89, 0xe6, 0xba, ...u32(1), 0x0f, 0x05], // mov rsi, rsp; edx=1; syscall
      ...[0x48, 0x83, 0xc3, 0x18, 0x41, 0xff, 0xcc, 0x75, 0xc0], // add rbx, 24; dec r12d; jne
      ...[0xb8, ...u32(231), 0x31, 0xff, 0x0f, 0x05], // exit_group(0)
      ...[0xb8, ...u32(231), 0xbf, ...u32(2), 0x0f, 0x05], // fail: exit_group(2)
    ]),
};

const SVC = 0xd4000001;
/** `movz x<rd>, #imm`. */
const movz = (rd: number, imm: number) => 0xd2800000 | (imm << 5) | rd;
/** `adr x<rd>, pc+off`. */
const adr = (rd: number, off: number) =>
  0x10000000 | ((off & 3) << 29) | (((off >> 2) & 0x7ffff) << 5) | rd;

/** aarch64: prctl 167, write 64, exit_group 94. */
const AARCH64: ProbeCode = {
  length: 0xa8,
  emit: (fprog, table, count) =>
    words([
      ...[movz(8, 167), movz(0, 38), movz(1, 1), movz(2, 0), movz(3, 0), movz(4, 0), SVC],
      ...[movz(8, 167), movz(0, 22), movz(1, 2), adr(2, fprog - 0x28), SVC],
      ...[0xb5000360, adr(19, table - 0x34), movz(20, count), 0xd10043ff], // cbnz x0, fail; sp-16
      ...[0xf9400268, 0xf9400660, 0xf9400a61], // loop: ldr x8/x0/x1, [x19, #0/8/16]
      ...[movz(2, 0), movz(3, 0), movz(4, 0), movz(5, 0), SVC],
      ...[0x4b0003e0, 0x12001400, 0x1100c000, 0x390003e0], // neg; and #0x3f; add #0x30; strb [sp]
      ...[movz(8, 64), movz(0, 1), 0x910003e1, movz(2, 1), SVC], // write(1, sp, 1)
      ...[0x91006273, 0xf1000694, 0x54fffda1], // add x19, #24; subs x20, #1; b.ne loop
      ...[movz(8, 94), movz(0, 0), SVC, movz(8, 94), movz(0, 2), SVC], // exit_group(0); fail: (2)
    ]),
};

function words(list: readonly number[]): Uint8Array {
  const out = new Uint8Array(list.length * 4);
  const view = new DataView(out.buffer);
  list.forEach((w, i) => view.setUint32(i * 4, w >>> 0, true));
  return out;
}

export const PROBE_CODE: Readonly<Record<FilterArch, ProbeCode>> = {
  x86_64: X86_64,
  aarch64: AARCH64,
};
