import { assert, assertEquals } from "@std/assert";
import { run, withServer } from "./cloud_stub.ts";

/**
 * A real curl sends each writer's request body from the private file
 * `cloud_send` hands it, to a real HTTP server: the body the server reads is
 * the one the writer built, and none of its text stood on curl's command line.
 */

const TEXT = "Body text with 'quotes', \"more\" and a\nsecond line";

Deno.test("cloud writers: the server reads the request body; curl's arguments hold none of it", async () => {
  await withServer(async (port, requests) => {
    const cases: [string, string[], Record<string, unknown>][] = [
      ["add.sh", ["A title", TEXT], { projectKey: "K", title: "A title", body: TEXT }],
      ["clarify-comment.sh", ["1", TEXT], { projectKey: "K", number: 1, body: TEXT }],
      ["move.sh", ["1", "In Progress"], { projectKey: "K", number: 1, status: "In Progress" }],
    ];
    for (const [script, args, want] of cases) {
      const before = (await requests()).length;
      const { code, out, curlLog } = await run(script, args, `http://127.0.0.1:${port}/ok`);
      assertEquals(code, 0, `${script}\n${out}`);
      const sent = (await requests()).slice(before) as unknown as { body: string }[];
      assertEquals(sent.length, 1, script);
      assertEquals(JSON.parse(sent[0].body), want, script);
      assert(!curlLog.includes("second line") && !curlLog.includes("In Progress"), curlLog);
    }
  });
});
