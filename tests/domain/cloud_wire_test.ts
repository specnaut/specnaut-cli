import { assertEquals, assertRejects } from "@std/assert";
import {
  clamp,
  cleanText,
  cloudFetch,
  isRedirectStatus,
  isUnavailableStatus,
  jsonObject,
  readJson,
  strField,
} from "../../src/domain/cloud/cloud_wire.ts";

Deno.test("isUnavailableStatus: no connection and 5xx only", () => {
  for (const s of [0, 500, 503, 599]) assertEquals(isUnavailableStatus(s), true, String(s));
  for (const s of [200, 307, 400, 401, 429, 499]) {
    assertEquals(isUnavailableStatus(s), false, String(s));
  }
});

Deno.test("isRedirectStatus: 3xx only", () => {
  for (const s of [300, 301, 307, 308, 399]) assertEquals(isRedirectStatus(s), true, String(s));
  for (const s of [0, 200, 299, 400, 503]) assertEquals(isRedirectStatus(s), false, String(s));
});

Deno.test("jsonObject: an object, and nothing else", () => {
  assertEquals(jsonObject({ a: 1 }), { a: 1 });
  for (const v of [null, [1], "x", 1, true, undefined]) assertEquals(jsonObject(v), null);
});

Deno.test("readJson: an object body is read; anything else reads as empty", async () => {
  assertEquals(await readJson(new Response('{"a":1}')), { a: 1 });
  for (const body of ["", "<html>", "null", "[1]", "1", '"x"']) {
    assertEquals(await readJson(new Response(body)), {}, body);
  }
});

Deno.test("readJson: a connection dropped mid-body rejects, an outage is not an empty answer", async () => {
  const dropped = new ReadableStream({ start: (c) => c.error(new TypeError("connection reset")) });
  await assertRejects(() => readJson(new Response(dropped)), TypeError);
});

Deno.test("cloudFetch: no caller can ask to follow a redirect", async () => {
  const seen: (RequestInit | undefined)[] = [];
  const fn = ((_: string, init?: RequestInit) => {
    seen.push(init);
    return Promise.resolve(new Response("{}"));
  }) as typeof fetch;
  await cloudFetch(fn, "https://x.test", { method: "PUT", redirect: "follow" });
  assertEquals(seen, [{ method: "PUT", redirect: "manual" }]);
});

Deno.test("cleanText and strField: no control character reaches a terminal, C1 included", () => {
  assertEquals(cleanText("a\x1b[31m\x07b\x9b1mc\x7f"), "a[31mb1mc");
  assertEquals(cleanText(undefined), "");
  assertEquals(cleanText("caf\u00e9 \u00a0 ~"), "caf\u00e9 \u00a0 ~");
  assertEquals(strField({ error: "x\x1by" }, "error"), "xy");
  assertEquals(strField({ error: 1 }, "error"), null);
});

Deno.test("clamp: into the range, NaN to the floor", () => {
  assertEquals([clamp(1, 5, 9), clamp(7, 5, 9), clamp(99, 5, 9), clamp(NaN, 5, 9)], [5, 7, 9, 5]);
});
