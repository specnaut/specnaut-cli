import { assertEquals, assertThrows } from "@std/assert";
import {
  answerOf,
  probeCalls,
  probeFilter,
  readProbe,
} from "../../src/domain/sandbox_filter_probe.ts";
import { seccompProfile } from "../../src/domain/sandbox_seccomp_profile.ts";
import { AF_VSOCK, DENIED_SYSCALLS, SYSCALL_NUMBERS } from "../../src/domain/sandbox_syscalls.ts";
import { verdict } from "./bpf_verdict.ts";

/**
 * The filter probe's calls and how its answers are read: every name of the container profile is
 * probed once, each refusal read from what the probe saw, and a name the probe saw pass the profile
 * is named dropped, not left out.
 */

const EPERM = 1;
const ENOSYS = 38;
const EINVAL = 22;
const RET_TRACE = 0x7ff00000;
const RET_ALLOW = 0x7fff0000;
const AUDIT_X86_64 = 0xc000003e;

/** Every name of the profile, once, in its order. */
const PROFILE_NAMES = [...new Set(seccompProfile().syscalls.flatMap((r) => r.names))];
/** The names x86_64 has and aarch64 lacks. */
const X86_ONLY = DENIED_SYSCALLS.filter((n) => SYSCALL_NUMBERS.aarch64[n] === undefined);

/** What the probe prints when the profile holds every call: each call's own refusal. */
const allHeld = (arch: "x86_64" | "aarch64") =>
  probeCalls(arch).map((c) => answerOf(c.refusal)).join("");

Deno.test("probeCalls: every name of the profile once, in its order; aarch64 without x86_64's", () => {
  assertEquals(probeCalls("x86_64").map((c) => c.name), PROFILE_NAMES);
  assertEquals(X86_ONLY, ["iopl", "ioperm", "uselib"]);
  const aarch64 = PROFILE_NAMES.filter((n) => !(X86_ONLY as readonly string[]).includes(n));
  assertEquals(probeCalls("aarch64").map((c) => c.name), aarch64);
});

Deno.test("probeCalls: each call with its machine's number, its first rule's argument, its errno", () => {
  const byName = (arch: "x86_64" | "aarch64") =>
    Object.fromEntries(probeCalls(arch).map((c) => [c.name, c]));
  const x86 = byName("x86_64");
  assertEquals(x86.mount, { name: "mount", nr: 165, args: [0, 0], refusal: EPERM, traced: true });
  assertEquals(x86.clone, {
    name: "clone",
    nr: 56,
    args: [0x20000, 0],
    refusal: EPERM,
    traced: true,
  });
  assertEquals(x86.socket, {
    name: "socket",
    nr: 41,
    args: [AF_VSOCK, 1],
    refusal: EPERM,
    traced: true,
  });
  assertEquals(x86.personality.args, [1, 0]);
  assertEquals(x86.clone3, {
    name: "clone3",
    nr: 435,
    args: [0, 0],
    refusal: ENOSYS,
    traced: false,
  });
  const arm = byName("aarch64");
  assertEquals([arm.mount.nr, arm.clone.nr, arm.socket.nr, arm.personality.nr], [40, 220, 198, 92]);
});

Deno.test("probeFilter: TRACE for every traced call's number, ALLOW for clone3 and the rest", () => {
  const calls = probeCalls("x86_64");
  const filter = probeFilter(calls);
  for (const call of calls) {
    assertEquals(verdict(filter, AUDIT_X86_64, call.nr), call.traced ? RET_TRACE : RET_ALLOW);
  }
  for (const nr of [0, 1, 157, 231, 435]) {
    assertEquals(verdict(filter, AUDIT_X86_64, nr), RET_ALLOW);
  }
});

Deno.test("probeFilter: refuses a table its jumps cannot span", () => {
  const many = Array.from({ length: 256 }, (_, nr) => ({ ...probeCalls("x86_64")[0], nr }));
  assertThrows(() => probeFilter(many), Error, "out of range");
});

Deno.test("readProbe: every call answered with its refusal is applied, none dropped", () => {
  for (const arch of ["x86_64", "aarch64"] as const) {
    const calls = probeCalls(arch);
    const names = calls.map((c) => c.name);
    assertEquals(readProbe(calls, allHeld(arch), 0), {
      kind: "observed",
      applied: names,
      dropped: [],
    });
  }
});

Deno.test("readProbe: a call that passed the profile is named dropped, not merely absent", () => {
  const calls = probeCalls("x86_64");
  const at = (name: string) => calls.findIndex((c) => c.name === name);
  const printed = [...allHeld("x86_64")];
  printed[at("open_tree_attr")] = answerOf(ENOSYS); // traced: the probe's own filter answered
  printed[at("clone3")] = answerOf(EINVAL); // untraced: the kernel refused its size of 0
  const record = readProbe(calls, printed.join(""), 0);
  const kept = calls.map((c) => c.name).filter((n) => n !== "open_tree_attr" && n !== "clone3");
  assertEquals(record, { kind: "observed", applied: kept, dropped: ["open_tree_attr", "clone3"] });
});

Deno.test("readProbe: a probe that failed or answered short is unobserved, nothing inferred", () => {
  const calls = probeCalls("aarch64");
  assertEquals(readProbe(calls, "", 2), { kind: "unobserved", why: "the filter probe exited 2" });
  const short = allHeld("aarch64").slice(1);
  assertEquals(readProbe(calls, short, 0), {
    kind: "unobserved",
    why: `the filter probe printed ${calls.length - 1} answers to ${calls.length} calls`,
  });
});

Deno.test("answerOf: each errno's low six bits past `0`, printable whatever the errno", () => {
  assertEquals([answerOf(EPERM), answerOf(ENOSYS), answerOf(EINVAL), answerOf(0)], [
    "1",
    "V",
    "F",
    "0",
  ]);
  assertEquals(answerOf(4095).charCodeAt(0), 0x30 + 0x3f);
});
