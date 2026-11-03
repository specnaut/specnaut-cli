import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { withServer } from "../scripts/cloud_stub.ts";

// The stubs elsewhere answer 307 whatever the redirect mode. This one is the real
// `fetch` against a real server: it reports the 3xx itself and goes nowhere.

const PROBE = fromFileUrl(new URL("./cloud_real_fetch_probe.ts", import.meta.url));

Deno.test("on the real fetch, every client sees the redirect as one and does not follow it", async () => {
  await withServer(async (port, requests) => {
    const { code, stdout, stderr } = await new Deno.Command("deno", {
      args: [
        "run",
        "--no-config",
        "--allow-net=127.0.0.1",
        PROBE,
        `http://127.0.0.1:${port}/moved`,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const dec = new TextDecoder();
    assertEquals(code, 0, dec.decode(stderr));
    assertEquals(JSON.parse(dec.decode(stdout)), [
      { name: "CloudApiError", status: 307 },
      { name: "CloudApiError", status: 307 },
      { name: "GateApiError", status: 307, reason: "redirected" },
      { name: "SpecApiError", status: 307, reason: "redirected" },
    ]);
    assertEquals((await requests()).filter((r) => r.path.startsWith("/elsewhere")), []);
  });
});
