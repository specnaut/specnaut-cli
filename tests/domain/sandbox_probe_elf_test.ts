import { assertEquals } from "@std/assert";
import { probeCalls, probeFilter } from "../../src/domain/sandbox_filter_probe.ts";
import { PROBE_CODE } from "../../src/domain/sandbox_probe_code.ts";
import { probeElf } from "../../src/domain/sandbox_probe_elf.ts";

/**
 * The filter probe as a static executable: its code as an assembler gives it, and its headers,
 * filter and table where the code and the kernel look for them. That it runs, and what it answers
 * under the CLI's profile, is the live test's (`sandbox_filter_probe_live_test.ts`).
 */

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/**
 * The code of `sandbox_probe_code.ts`'s comment, as `clang -c` assembles it for each target, the
 * `sock_fprog` and the table both just past the code (at its length) and 60 calls.
 */
const ASSEMBLED = {
  aarch64: "e81480d2c00480d2210080d2020080d2030080d2040080d2010000d4e81480d2c00280d2410080d2" +
    "02040010010000d4600300b5b3030010940780d2ff4300d1680240f9600640f9610a40f9020080d2" +
    "030080d2040080d2050080d2010000d4e003004b0014001200c00011e0030039080880d2200080d2" +
    "e1030091220080d2010000d473620091940600f1a1fdff54c80b80d2000080d2010000d4c80b80d2" +
    "400080d2010000d4",
  x86_64: "b89d000000bf26000000be0100000031d24531d24531c00f05b89d000000bf16000000be02000000" +
    "488d156d0000000f054885c0755a488d1d5f00000041bc3c0000004883ec10488b03488b7b08488b" +
    "731031d24531d24531c04531c90f05f7d883e03f83c030880424b801000000bf010000004889e6ba" +
    "010000000f054883c31841ffcc75c0b8e700000031ff0f05b8e7000000bf020000000f05",
} as const;

for (const arch of ["x86_64", "aarch64"] as const) {
  Deno.test(`PROBE_CODE.${arch}: the bytes an assembler gives its instructions`, () => {
    const code = PROBE_CODE[arch];
    assertEquals(hex(code.emit(code.length, code.length, 60)), ASSEMBLED[arch]);
    assertEquals(code.emit(0, 0, 1).length, code.length);
  });

  Deno.test(`probeElf(${arch}): one read-and-execute segment, its code, filter and table`, () => {
    const calls = probeCalls(arch);
    const elf = probeElf(arch, calls);
    const view = new DataView(elf.buffer);
    const u64 = (at: number) => Number(view.getBigUint64(at, true));
    assertEquals([...elf.subarray(0, 7)], [0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
    assertEquals([view.getUint16(16, true), view.getUint16(18, true)], [2, MACHINE[arch]]);
    assertEquals([u64(24), u64(32), view.getUint16(56, true)], [0x400078, 64, 1]);
    // PT_LOAD, R|X, the whole file at the base.
    assertEquals([view.getUint32(64, true), view.getUint32(68, true), u64(72), u64(80)], [
      1,
      5,
      0,
      0x400000,
    ]);
    assertEquals([u64(96), u64(104)], [elf.length, elf.length]);
    const code = PROBE_CODE[arch];
    const fprog = 120 + Math.ceil(code.length / 8) * 8;
    const filter = probeFilter(calls);
    const table = fprog + 16 + filter.length;
    assertEquals(
      hex(elf.subarray(120, 120 + code.length)),
      hex(code.emit(fprog - 120, table - 120, calls.length)),
    );
    assertEquals([view.getUint16(fprog, true), u64(fprog + 8)], [
      filter.length / 8,
      0x400000 + fprog + 16,
    ]);
    assertEquals(hex(elf.subarray(fprog + 16, table)), hex(filter));
    const entries = calls.map((_, i) => [0, 8, 16].map((j) => u64(table + i * 24 + j)));
    assertEquals(entries, calls.map((c) => [c.nr, ...c.args]));
    assertEquals(elf.length, table + calls.length * 24);
  });
}

const MACHINE = { x86_64: 62, aarch64: 183 } as const;
