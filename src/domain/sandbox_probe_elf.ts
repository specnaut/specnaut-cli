/**
 * The filter probe as a program: a static Linux executable, built here as bytes, that a container
 * runs whatever its image holds. A shell has no way to make an arbitrary syscall, and an image is
 * not known to carry anything that does, so the probe brings its own few instructions.
 *
 * It sets no-new-privileges (the run has it already), adds the probe's own filter
 * (`probeFilter`) with `prctl(PR_SET_SECCOMP)`, and exits 2 if that fails. Then, for each call of
 * the table, it makes the call with its number and first two arguments (the rest zero), and
 * writes one byte to its standard output: the call's errno, as `answerOf` spells it. It exits 0.
 *
 * One read-and-execute segment holds the code, then the `sock_fprog` naming the filter, the
 * filter, and the table (each call's number and arguments, 64 bits each). Loaded at
 * {@link BASE}, where `sock_fprog`'s pointer names the filter; the code reaches its data relative
 * to itself. Its one byte of writable memory is on the stack the kernel gives it.
 *
 * Pure: the caller writes it to a file the container runs.
 */

import type { FilterArch } from "./sandbox_syscalls.ts";
import { type ProbeCall, probeFilter } from "./sandbox_filter_probe.ts";
import { PROBE_CODE } from "./sandbox_probe_code.ts";

/** Where the segment is loaded: the conventional base of a static executable. */
const BASE = 0x400000;
const ELF_HEADER = 64;
const PROGRAM_HEADER = 56;
const CODE_AT = ELF_HEADER + PROGRAM_HEADER;
const FPROG = 16;
const ENTRY = 24;
const MACHINE: Readonly<Record<FilterArch, number>> = { x86_64: 62, aarch64: 183 };

/** The probe for `arch`, making `calls` in order. */
export function probeElf(arch: FilterArch, calls: readonly ProbeCall[]): Uint8Array {
  const code = PROBE_CODE[arch];
  const filter = probeFilter(calls);
  const fprogAt = CODE_AT + Math.ceil(code.length / 8) * 8;
  const tableAt = fprogAt + FPROG + filter.length;
  const out = new Uint8Array(tableAt + calls.length * ENTRY);
  const view = new DataView(out.buffer);
  header(view, arch, out.length);
  out.set(code.emit(fprogAt - CODE_AT, tableAt - CODE_AT, calls.length), CODE_AT);
  view.setUint16(fprogAt, filter.length / 8, true);
  view.setBigUint64(fprogAt + 8, BigInt(BASE + fprogAt + FPROG), true);
  out.set(filter, fprogAt + FPROG);
  calls.forEach(({ nr, args }, i) => {
    [nr, ...args].forEach((v, j) =>
      view.setBigUint64(tableAt + i * ENTRY + j * 8, BigInt(v), true)
    );
  });
  return out;
}

/** The ELF header and the one program header: a static executable of one segment, `size` long. */
function header(view: DataView, arch: FilterArch, size: number): void {
  [0x7f, 0x45, 0x4c, 0x46, 2, 1, 1].forEach((b, i) => view.setUint8(i, b));
  view.setUint16(16, 2, true); // ET_EXEC
  view.setUint16(18, MACHINE[arch], true);
  view.setUint32(20, 1, true);
  view.setBigUint64(24, BigInt(BASE + CODE_AT), true);
  view.setBigUint64(32, BigInt(ELF_HEADER), true);
  view.setUint16(52, ELF_HEADER, true);
  view.setUint16(54, PROGRAM_HEADER, true);
  view.setUint16(56, 1, true);
  const ph = ELF_HEADER;
  view.setUint32(ph, 1, true); // PT_LOAD
  view.setUint32(ph + 4, 5, true); // read and execute
  view.setBigUint64(ph + 16, BigInt(BASE), true);
  view.setBigUint64(ph + 24, BigInt(BASE), true);
  view.setBigUint64(ph + 32, BigInt(size), true);
  view.setBigUint64(ph + 40, BigInt(size), true);
  view.setBigUint64(ph + 48, 0x1000n, true);
}
