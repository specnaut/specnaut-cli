import { assertEquals, assertStringIncludes } from "@std/assert";
import { run, withServer } from "./cloud_stub.ts";

/**
 * `reconcile.sh`'s arguments: `--limit` reaches the activity request's query
 * string, so it is a page size of 1 to 999 and nothing else.
 */

const LIMIT_REFUSED = "--limit is a page size, 1 to 999";

Deno.test("reconcile.sh: a --limit that is not a page size is a usage error, and nothing is asked", async () => {
  await withServer(async (port, requests) => {
    for (const args of [["1&projectKey=OTHER"], ["0"], ["abc"], ["1000"], ["100000"]]) {
      const { code, out } = await run(
        "reconcile.sh",
        ["--limit", ...args],
        `http://127.0.0.1:${port}/ok`,
      );
      assertEquals(code, 2, `${args}\n${out}`);
      assertStringIncludes(out, LIMIT_REFUSED, `${args}`);
    }
    assertEquals(await requests(), []);
  });
});

Deno.test("reconcile.sh: the largest page size reaches the request as given", async () => {
  await withServer(async (port) => {
    const { curlLog, out } = await run(
      "reconcile.sh",
      ["--limit", "999"],
      `http://127.0.0.1:${port}/ok`,
    );
    assertStringIncludes(curlLog, "limit=999", out);
  });
});
