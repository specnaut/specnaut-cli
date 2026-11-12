import { assert, assertEquals } from "@std/assert";
import { LogFilter } from "../../src/domain/inert_log.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

Deno.test("a log keeps text, tabs and line feeds, and drops every other control", () => {
  const f = new LogFilter();
  assertEquals(dec(f.push(enc("ok\tdone\n\u001b[2J\r\u0007\u007fé\u0085x"))), "ok\tdone\n[2Jéx");
});

Deno.test("a C1 control split across two chunks is dropped, a C2 letter kept", () => {
  const f = new LogFilter();
  const bytes = enc("a\u009b");
  assertEquals(dec(f.push(bytes.slice(0, 2))), "a");
  assertEquals(f.push(bytes.slice(2)).length, 0);
  assertEquals(dec(f.push(enc("©"))), "©");
});

Deno.test("a log stops at its cap and says it was cut", () => {
  const f = new LogFilter(5);
  assertEquals(dec(f.push(enc("abc"))), "abc");
  assert(!f.truncated);
  assertEquals(dec(f.push(enc("defg"))), "de");
  assertEquals(f.push(enc("h")).length, 0);
  assert(f.truncated);
});

/** True when `bytes` spell a C1 control in UTF-8 (`C2 80`..`C2 9F`) anywhere. */
const spellsC1 = (bytes: Uint8Array) =>
  bytes.some((b, i) => b === 0xc2 && (bytes[i + 1] ?? 0) >= 0x80 && (bytes[i + 1] ?? 0) <= 0x9f);

Deno.test("a control between a lead byte and a C1 continuation cannot join them into a C1 control", () => {
  const cases: number[][][] = [
    [[0xc2, 0x01, 0x9b]],
    [[0xc2, 0xc2, 0x01, 0x9b]],
    [[0xc2], [0x01], [0x9b]],
    [[0x61, 0xc2], [0x01, 0x9b, 0x62]],
  ];
  for (const chunks of cases) {
    const f = new LogFilter();
    const parts = [...chunks.map((c) => f.push(Uint8Array.from(c))), f.end()];
    const out = Uint8Array.from(parts.flatMap((p) => [...p]));
    assert(!spellsC1(out), `${JSON.stringify(chunks)} -> ${[...out]}`);
    // deno-lint-ignore no-control-regex
    assert(!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(dec(out)), dec(out));
  }
});

Deno.test("a sequence cut at the end of the run is kept as a replacement, never as raw bytes", () => {
  const f = new LogFilter();
  assertEquals(dec(f.push(Uint8Array.from([0x61, 0xc2]))), "a");
  assertEquals(dec(f.end()), "�");
});
