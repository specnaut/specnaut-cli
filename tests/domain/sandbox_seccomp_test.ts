import { assert, assertEquals, assertThrows } from "@std/assert";
import { isFilterArch, SECCOMP_FD, seccompFilter } from "../../src/domain/sandbox_seccomp.ts";
import {
  AF_VSOCK,
  DENIED_SYSCALLS,
  PERSONALITY_NUMBERS,
  SOCKET_NUMBERS,
  SYSCALL_NUMBERS,
} from "../../src/domain/sandbox_syscalls.ts";

/**
 * The syscall filter bubblewrap loads before it runs a branch's gates. The program is run here by a
 * classic-BPF interpreter over `struct seccomp_data`, as the kernel would run it, so its verdict
 * for each architecture and call is checked on any host, Linux or not.
 */

const RET_KILL_PROCESS = 0x80000000;
const RET_ERRNO_EPERM = 0x00050001;
const RET_ALLOW = 0x7fff0000;
const AUDIT = { x86_64: 0xc000003e, aarch64: 0xc00000b7, i386: 0x40000003, arm: 0x40000028 };

/** The kernel's answer to call `nr` under architecture `arch`, with `arg0` its first argument. */
function verdict(program: Uint8Array, arch: number, nr: number, arg0 = 0): number {
  const data = new DataView(new ArrayBuffer(64));
  data.setInt32(0, nr, true);
  data.setUint32(4, arch, true);
  data.setUint32(16, arg0, true);
  const code = new DataView(program.buffer, program.byteOffset, program.byteLength);
  let acc = 0;
  for (let pc = 0; pc * 8 < program.length; pc++) {
    const op = code.getUint16(pc * 8, true);
    const [jt, jf] = [code.getUint8(pc * 8 + 2), code.getUint8(pc * 8 + 3)];
    const k = code.getUint32(pc * 8 + 4, true);
    if (op === 0x20) acc = data.getUint32(k, true);
    else if (op === 0x06) return k;
    else if (op === 0x15) pc += acc === k ? jt : jf;
    else if (op === 0x35) pc += acc >= k ? jt : jf;
    else if (op === 0x45) pc += (acc & k) !== 0 ? jt : jf;
    else throw new Error(`instruction ${pc}: opcode ${op.toString(16)} is not interpreted`);
  }
  throw new Error("the program ran past its end without returning");
}

/** Calls every build and test needs: read, write, openat, execve, clone, exit_group. */
const EVERYDAY = { x86_64: [0, 1, 257, 59, 56, 231], aarch64: [63, 64, 56, 221, 220, 94] };

for (const arch of ["x86_64", "aarch64"] as const) {
  const program = seccompFilter(arch);

  Deno.test(`seccompFilter(${arch}): every denied call fails with EPERM`, () => {
    for (const name of DENIED_SYSCALLS) {
      const nr = SYSCALL_NUMBERS[arch][name];
      if (nr === undefined) continue;
      assertEquals(verdict(program, AUDIT[arch], nr), RET_ERRNO_EPERM, name);
    }
  });

  Deno.test(`seccompFilter(${arch}): the calls a build makes are allowed`, () => {
    for (const nr of EVERYDAY[arch]) assertEquals(verdict(program, AUDIT[arch], nr), RET_ALLOW);
  });

  Deno.test(`seccompFilter(${arch}): a call under another architecture kills the process`, () => {
    for (const other of Object.values(AUDIT).filter((a) => a !== AUDIT[arch])) {
      assertEquals(verdict(program, other, EVERYDAY[arch][0]), RET_KILL_PROCESS);
    }
  });

  Deno.test(`seccompFilter(${arch}): socket(AF_VSOCK) fails with EPERM; other families pass`, () => {
    const socket = SOCKET_NUMBERS[arch];
    assertEquals(verdict(program, AUDIT[arch], socket, AF_VSOCK), RET_ERRNO_EPERM);
    for (const family of [1, 2, 10, 16, 41]) {
      assertEquals(verdict(program, AUDIT[arch], socket, family), RET_ALLOW, String(family));
    }
    // Another call is not the rule's business, whatever its first argument or its number.
    assertEquals(verdict(program, AUDIT[arch], EVERYDAY[arch][0], AF_VSOCK), RET_ALLOW);
    if (!Object.values(SYSCALL_NUMBERS[arch]).includes(AF_VSOCK)) {
      assertEquals(verdict(program, AUDIT[arch], AF_VSOCK), RET_ALLOW, "call number 40");
    }
  });

  Deno.test(`seccompFilter(${arch}): whole instructions, within the kernel's length cap`, () => {
    assertEquals(program.length % 8, 0);
    assert(program.length / 8 <= 4096);
  });
}

Deno.test("seccompFilter(x86_64): every x32 call fails, as an x32 call bypasses the numbers", () => {
  const program = seccompFilter("x86_64");
  for (const nr of [0x40000000, 0x40000000 + 165, 0x40000000 + 59]) {
    assertEquals(verdict(program, AUDIT.x86_64, nr), RET_ERRNO_EPERM, String(nr));
  }
});

Deno.test("isFilterArch: a filter exists for x86_64 and aarch64 only", () => {
  assert(isFilterArch("x86_64"));
  assert(isFilterArch("aarch64"));
  for (const arch of ["riscv64", "arm", "", "x86"]) assert(!isFilterArch(arch), arch);
  assertThrows(() => seccompFilter("riscv64" as "x86_64"), Error, "riscv64");
});

Deno.test("SECCOMP_FD: past the three standard streams", () => {
  assertEquals(SECCOMP_FD, 3);
});

// The values the engines' default profiles let `personality` take, as the container profile does.
const PERSONAS = { PER_LINUX: 0, PER_LINUX32: 8, UNAME26: 0x20000, BOTH: 0x20008 };

for (const arch of ["x86_64", "aarch64"] as const) {
  Deno.test(`seccompFilter(${arch}): personality takes the persona values and nothing else`, () => {
    const program = seccompFilter(arch);
    const call = (v: number) => verdict(program, AUDIT[arch], PERSONALITY_NUMBERS[arch], v);
    for (const [name, v] of Object.entries(PERSONAS)) assertEquals(call(v), RET_ALLOW, name);
    for (let b = 0; b < 32; b++) {
      const bit = 2 ** b;
      const expected = bit === 8 || bit === 0x20000 ? RET_ALLOW : RET_ERRNO_EPERM;
      assertEquals(call(bit), expected, `bit ${b}`);
      assertEquals(call(bit | 8), expected, `bit ${b} | 8`);
    }
    assertEquals(call(0xffffffff), RET_ERRNO_EPERM, "the read-only query");
    // Another call is not the rule's business, whatever its first argument.
    assertEquals(verdict(program, AUDIT[arch], EVERYDAY[arch][0], 0x40000), RET_ALLOW);
    assertEquals(verdict(program, AUDIT[arch], SOCKET_NUMBERS[arch], 0x40000), RET_ALLOW);
  });
}
