import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  DENIED_SYSCALLS,
  isFilterArch,
  SECCOMP_FD,
  seccompFilter,
  SYSCALL_NUMBERS,
} from "../../src/domain/sandbox_seccomp.ts";

/**
 * The syscall filter bubblewrap loads before it runs a branch's gates. The program is run here by a
 * classic-BPF interpreter over `struct seccomp_data`, as the kernel would run it, so its verdict
 * for each architecture and call is checked on any host, Linux or not.
 */

const RET_KILL_PROCESS = 0x80000000;
const RET_ERRNO_EPERM = 0x00050001;
const RET_ALLOW = 0x7fff0000;
const AUDIT = { x86_64: 0xc000003e, aarch64: 0xc00000b7, i386: 0x40000003, arm: 0x40000028 };

/** What the kernel answers for a call `nr` made under architecture `arch`. */
function verdict(program: Uint8Array, arch: number, nr: number): number {
  const data = new DataView(new ArrayBuffer(64));
  data.setInt32(0, nr, true);
  data.setUint32(4, arch, true);
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

  Deno.test(`seccompFilter(${arch}): whole instructions, within the kernel's length cap`, () => {
    assertEquals(program.length % 8, 0);
    assert(program.length / 8 <= 4096);
  });

  Deno.test(`SYSCALL_NUMBERS.${arch}: no two calls share a number`, () => {
    const numbers = Object.values(SYSCALL_NUMBERS[arch]);
    assertEquals(new Set(numbers).size, numbers.length);
  });
}

Deno.test("seccompFilter(x86_64): every x32 call fails, as an x32 call bypasses the numbers", () => {
  const program = seccompFilter("x86_64");
  for (const nr of [0x40000000, 0x40000000 + 165, 0x40000000 + 59]) {
    assertEquals(verdict(program, AUDIT.x86_64, nr), RET_ERRNO_EPERM, String(nr));
  }
});

Deno.test("seccompFilter: mounting, namespaces, keyrings, modules and bpf are denied", () => {
  for (
    const name of [
      "mount",
      "umount2",
      "pivot_root",
      "unshare",
      "setns",
      "fsopen",
      "open_tree",
      "keyctl",
      "add_key",
      "init_module",
      "finit_module",
      "kexec_load",
      "bpf",
      "perf_event_open",
      "userfaultfd",
      "io_uring_setup",
      "open_by_handle_at",
      "ptrace",
    ] as const
  ) {
    if (name === "ptrace") {
      assert(!(DENIED_SYSCALLS as readonly string[]).includes(name), "ptrace stays allowed");
      continue;
    }
    assert(DENIED_SYSCALLS.includes(name), name);
    for (const arch of ["x86_64", "aarch64"] as const) {
      assert(SYSCALL_NUMBERS[arch][name] !== undefined, `${name} on ${arch}`);
    }
  }
});

Deno.test("SYSCALL_NUMBERS: a call missing on an architecture is one it does not have", () => {
  const missing = DENIED_SYSCALLS.filter((n) => SYSCALL_NUMBERS.aarch64[n] === undefined);
  assertEquals(missing, ["iopl", "ioperm", "uselib"]);
  assertEquals(DENIED_SYSCALLS.filter((n) => SYSCALL_NUMBERS.x86_64[n] === undefined), []);
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
