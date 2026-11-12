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
