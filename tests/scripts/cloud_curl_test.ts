import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { REDIRECT_REFUSED } from "../../src/domain/cloud/cloud_wire.ts";
import { CLOUD, run, textRule, TOKEN, withServer } from "./cloud_stub.ts";

// The Cloud backlog scripts make every request through `cloud_curl`. Real scripts, a
// real curl and a real HTTP server: a shim on PATH records what curl was handed,
// then runs it.

const SCRIPTS: [string, string[]][] = [
  ["add.sh", ["t"]],
  ["cascade-check.sh", ["1"]],
  ["clarify-comment.sh", ["1", "q"]],
  ["columns.sh", []],
  ["groom-verify.sh", ["1"]],
  ["list.sh", []],
  ["move.sh", ["1", "Done"]],
  ["parent-of.sh", ["1"]],
  ["reconcile.sh", []],
  ["view.sh", ["1"]],
];

Deno.test("cloud scripts: each request is authorized, and curl's arguments hold only the request", async () => {
  await withServer(async (port, requests) => {
    let seen = 0;
    for (const [script, args] of SCRIPTS) {
      const { curlLog, out } = await run(script, args, `http://127.0.0.1:${port}/ok`);
      const all = await requests();
      const mine = all.slice(seen);
      seen = all.length;
      assertEquals(mine.length > 0, true, `${script}: no request\n${out}`);
      for (const r of mine) assertEquals(r.authorization, `Bearer ${TOKEN}`, script);
      assertEquals(curlLog.includes(TOKEN), false, `${script}: ${curlLog}`);
    }
  });
});

Deno.test("cloud scripts: a redirect is a failure, is said, and is not followed", async () => {
  await withServer(async (port, requests) => {
    for (const [script, args] of SCRIPTS) {
      const { code, out } = await run(script, args, `http://127.0.0.1:${port}/moved`);
      assertEquals(code !== 0, true, `${script} succeeded\n${out}`);
      assertStringIncludes(out, `error: ${REDIRECT_REFUSED}.`, script);
      assertEquals(out.includes("✓"), false, `${script}\n${out}`);
    }
    assertEquals((await requests()).filter((r) => r.path.startsWith("/elsewhere")), []);
  });
});

Deno.test("cascade-check: exit 3 when a read is not answered with a 2xx", async () => {
  await withServer(async (port) => {
    const { code } = await run("cascade-check.sh", ["1"], `http://127.0.0.1:${port}/moved`);
    assertEquals(code, 3);
  });
});

Deno.test("cloud scripts: curl runs on what the script gives it, whatever the user's own config says", async () => {
  await withServer(async (port, requests) => {
    const curlrc = 'location\nheader = "X-From-User-Config: 1"\n';
    for (const [script, args] of SCRIPTS) {
      await run(script, args, `http://127.0.0.1:${port}/moved`, { curlrc });
      const { curlLog } = await run(script, args, `http://127.0.0.1:${port}/ok`, { curlrc });
      const calls = curlLog.split("\n").filter((l) => l.startsWith("ARGS "));
      assertEquals(calls.length > 0, true, script);
      for (const c of calls) assertEquals(c.startsWith("ARGS -q "), true, `${script}: ${c}`);
    }
    const all = await requests();
    assertEquals(all.length > 0, true);
    assertEquals(all.filter((r) => r.path.startsWith("/elsewhere")), []);
    assertEquals(all.filter((r) => r.extra !== null), []);
  });
});

Deno.test("cloud_curl: a token is sent exactly as it is, and one with a control character is refused", async () => {
  await withServer(async (port, requests) => {
    const odd = 'a"b\\c';
    await run("columns.sh", [], `http://127.0.0.1:${port}/ok`, { token: odd });
    assertEquals((await requests()).map((r) => r.authorization), [`Bearer ${odd}`]);
    const r = await run("columns.sh", [], `http://127.0.0.1:${port}/ok`, { token: "a\tb" });
    assertEquals(r.code, 2, r.out);
    assertEquals(r.curlLog, "");
    assertEquals((await requests()).length, 1);
  });
});

Deno.test("no cloud script reaches curl except through cloud_curl", async () => {
  for await (const f of Deno.readDir(CLOUD)) {
    if (f.name === "_config.sh") continue;
    const text = await Deno.readTextFile(join(CLOUD, f.name));
    assertEquals(/(^|[\s($])curl\s+-/m.test(text), false, f.name);
    assertEquals(text.includes("Authorization"), false, f.name);
    assertEquals(text.includes("API_TOKEN"), false, f.name);
  }
});

Deno.test("cloud_curl: the answer comes back whole, and the script succeeds", async () => {
  await withServer(async (port) => {
    const { code, out } = await run("columns.sh", [], `http://127.0.0.1:${port}/ok`);
    assertEquals(code, 0, out);
    assertEquals(out, "  1\tTodo\n  2\tDone\n");
  });
});

Deno.test("cloud scripts: every 3xx is a failure, with or without somewhere to go", async () => {
  await withServer(async (port) => {
    for (const status of [300, 301, 302, 303, 304, 308]) {
      const r = await run("columns.sh", [], `http://127.0.0.1:${port}/status/${status}`);
      assertEquals(r.code !== 0, true, `${status}\n${r.out}`);
      assertStringIncludes(r.out, "redirected the request", String(status));
    }
  });
});

Deno.test("cloud scripts: an HTTP error or no connection fails, and is not called a redirect", async () => {
  await withServer(async (port) => {
    const urls = [
      `http://127.0.0.1:${port}/status/404`,
      `http://127.0.0.1:${port}/status/500`,
      "http://127.0.0.1:1/ok",
    ];
    for (const url of urls) {
      for (const script of ["columns.sh", "cascade-check.sh", "parent-of.sh"]) {
        const r = await run(script, ["1"], url);
        assertEquals(r.code !== 0, true, `${script} ${url}\n${r.out}`);
        assertEquals(r.out.includes("✓"), false, `${script} ${url}\n${r.out}`);
        assertEquals(r.out.includes("redirected"), false, `${script} ${url}\n${r.out}`);
      }
    }
  });
});

Deno.test("cascade-check and parent-of: a 2xx that is not the contract is a failed lookup", async () => {
  await withServer(async (port) => {
    const url = `http://127.0.0.1:${port}/partial`;
    const gate = await run("cascade-check.sh", ["1"], url);
    assertEquals(gate.code, 3, gate.out);
    assertEquals(gate.out.includes("✓"), false, gate.out);
    const parent = await run("parent-of.sh", ["1"], url);
    assertEquals(parent.code, 3, parent.out);
  });
});

Deno.test("cloud scripts: curl's environment does not gain the token, even under an inherited name", async () => {
  await withServer(async (port) => {
    const { curlLog } = await run("columns.sh", [], `http://127.0.0.1:${port}/ok`, {
      env: { API_TOKEN: "inherited" },
    });
    assertEquals(curlLog.includes(" env:\n"), true, curlLog);
  });
});

// deno-lint-ignore no-control-regex
const NOT_PLAIN = /[\x00-\x08\x0b-\x1f\x7f-\x9f\u200e\u200f\u2028-\u202e\u2066-\u2069]/;

Deno.test("cloud scripts: strings come back normalized", async () => {
  await withServer(async (port) => {
    const url = `http://127.0.0.1:${port}/dirty`;
    const seen: [string, string[], string][] = [
      ["add.sh", ["t"], "created: K-1]0;x\n"],
      ["cascade-check.sh", ["1"], "child next café 日本 👩‍💻]0;x"],
      ["columns.sh", [], "1\tTodo]0;x\n"],
      ["list.sh", [], "child next café 日本 👩‍💻]0;x"],
      ["parent-of.sh", ["1"], "cannot read: 2]0;x"],
      ["reconcile.sh", [], "CREATED 1 -> Todo next]0;x\n"],
      ["reconcile.sh", [], "MOVED ? old → extra -> new → more\n"],
      ["view.sh", ["1"], "first\nsecond\tthird\nfourth]0;x"],
    ];
    for (const [script, args, expected] of seen) {
      const { out } = await run(script, args, url);
      assertStringIncludes(out, expected, script);
      assertEquals(out.match(NOT_PLAIN), null, `${script}\n${JSON.stringify(out)}`);
    }
    const groom = await run("groom-verify.sh", ["1"], url);
    assertStringIncludes(groom.out, "#1", groom.out);
    assertEquals(groom.out.match(NOT_PLAIN), null, JSON.stringify(groom.out));
  });
});

Deno.test("cloud scripts: a refusal is reported with its text normalized, keys included", async () => {
  await withServer(async (port) => {
    const refusals: [string, string[], string][] = [
      ["add.sh", ["t"], "create failed: "],
      ["clarify-comment.sh", ["1", "q"], "comment failed: "],
      ["move.sh", ["1", "Done"], "move failed: "],
      ["reconcile.sh", [], "reconcile failed: "],
    ];
    for (const [script, args, words] of refusals) {
      const { code, out } = await run(script, args, `http://127.0.0.1:${port}/refused`);
      assertEquals(code, 1, `${script}\n${out}`);
      assertStringIncludes(out, words, script);
      assertStringIncludes(out, "no]0;x", script);
      assertStringIncludes(out, "key]0;x", script);
      assertEquals(out.match(NOT_PLAIN), null, `${script}\n${JSON.stringify(out)}`);
    }
  });
});

Deno.test("cloud scripts: an answer that is no JSON is a failure", async () => {
  await withServer(async (port) => {
    for (const [script, args] of SCRIPTS) {
      const { code, out } = await run(script, args, `http://127.0.0.1:${port}/garbage`);
      assertEquals(code !== 0, true, `${script}\n${out}`);
      assertStringIncludes(out, "something other than JSON", script);
      assertEquals(out.includes("<html>"), false, `${script}\n${out}`);
    }
  });
});

Deno.test("cloud_curl: an empty success stays empty, and is not called bad JSON", async () => {
  await withServer(async (port) => {
    const { code, out } = await run(
      "cascade-check.sh",
      ["1"],
      `http://127.0.0.1:${port}/status/204`,
    );
    assertEquals(code, 3, out);
    assertEquals(out.includes("something other than JSON"), false, out);
  });
});

Deno.test("CLOUD_JSON, and the character rule it is built on, use no regex", async () => {
  const config = await Deno.readTextFile(join(CLOUD, "_config.sh"));
  const start = config.indexOf(`CLOUD_JSON="$ISSUE_TEXT_JQ"'`);
  assertEquals(start > 0, true, "the filter moved");
  const filter = (await textRule()) + config.slice(start, config.indexOf("cloud_curl() {"));
  assertEquals(/gsub|\btest\(|\bsub\(/.test(filter), false, filter);
});

Deno.test("cloud_curl: a jq that cannot run the filter is reported as that", async () => {
  await withServer(async (port) => {
    const { code, out } = await run("columns.sh", [], `http://127.0.0.1:${port}/ok`, {
      jqRefusesFilter: true,
    });
    assertEquals(code !== 0, true, out);
    assertStringIncludes(out, "cannot run on this version of jq");
    assertEquals(out.includes("other than JSON"), false, out);
  });
});
