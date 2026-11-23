/**
 * A classic-BPF interpreter over `struct seccomp_data`, as the kernel runs a syscall filter, so a
 * filter's verdict for each architecture and call is checked on any host, Linux or not.
 */

/** The kernel's answer to call `nr` under architecture `arch`, with `arg0` its first argument. */
export function verdict(program: Uint8Array, arch: number, nr: number, arg0 = 0): number {
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
