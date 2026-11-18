import { assert, assertEquals } from "@std/assert";
import {
  DENIED_SYSCALLS,
  PERSONALITY_NUMBERS,
  SYSCALL_NUMBERS,
} from "../../src/domain/sandbox_syscalls.ts";

/** What both sandbox backends refuse, and the kernel's number for each call on each architecture. */

for (const arch of ["x86_64", "aarch64"] as const) {
  Deno.test(`SYSCALL_NUMBERS.${arch}: no two calls share a number`, () => {
    const numbers = Object.values(SYSCALL_NUMBERS[arch]);
    assertEquals(new Set(numbers).size, numbers.length);
  });
}

Deno.test("DENIED_SYSCALLS: mounting, namespaces, keyrings, modules and bpf, numbered on both architectures", () => {
  for (
    const name of [
      "mount",
      "umount2",
      "pivot_root",
      "unshare",
      "setns",
      "fsopen",
      "open_tree",
      "open_tree_attr",
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

Deno.test("the shared list's newest calls have a number on both architectures", () => {
  const expected = {
    x86_64: { kcmp: 312, fanotify_init: 300, mbind: 237, set_mempolicy: 238, get_mempolicy: 239 },
    aarch64: { kcmp: 272, fanotify_init: 262, mbind: 235, set_mempolicy: 237, get_mempolicy: 236 },
  } as const;
  for (const arch of ["x86_64", "aarch64"] as const) {
    for (const [name, nr] of Object.entries(expected[arch])) {
      assertEquals((SYSCALL_NUMBERS[arch] as Record<string, number>)[name], nr, `${arch} ${name}`);
    }
    assertEquals((SYSCALL_NUMBERS[arch] as Record<string, number>).set_mempolicy_home_node, 450);
    // The unified table's number, checked against x86's syscall_64.tbl and arm64's.
    assertEquals((SYSCALL_NUMBERS[arch] as Record<string, number>).open_tree_attr, 467);
  }
});

Deno.test("PERSONALITY_NUMBERS: the kernel's, per architecture", () => {
  assertEquals(PERSONALITY_NUMBERS, { x86_64: 135, aarch64: 92 });
});
