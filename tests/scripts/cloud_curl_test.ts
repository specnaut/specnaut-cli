import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

// The Cloud backlog scripts make every request through `cloud_curl`. Real scripts, a
// real curl and a real HTTP server: a shim on PATH records what curl was handed,
// then runs it.

const CLOUD = fromFileUrl(
  new URL("../../templates/core/skills/task/scripts/cloud", import.meta.url),
);
const RULES = fromFileUrl(
  new URL("../../templates/core/specnaut/scripts/bash/groom-rules.sh", import.meta.url),
);
const SERVER = fromFileUrl(new URL("./cloud_stub_server.ts", import.meta.url));
const TOKEN = "tok-Secret.123";

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

type Request = { path: string; authorization: string | null; extra: string | null };

/** The stub server, for the length of `fn`. */
async function withServer(fn: (port: string, requests: () => Promise<Request[]>) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "cloud-stub-" });
  const child = new Deno.Command("deno", {
    args: ["run", "--no-config", "--allow-net=127.0.0.1", `--allow-write=${dir}`, SERVER, dir],
    stdout: "null",
    stderr: "null",
  }).spawn();
  try {
    let port = "";
    for (let i = 0; i < 300 && !port; i++) {
      port = await Deno.readTextFile(join(dir, "port")).catch(() => "");
      if (!port) await new Promise((r) => setTimeout(r, 100));
    }
    assertEquals(port !== "", true, "the stub server did not start");
    await fn(port, async () => {
      const log = await Deno.readTextFile(join(dir, "requests.log")).catch(() => "");
      return log.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    });
  } finally {
    child.kill();
    await child.status;
    await Deno.remove(dir, { recursive: true });
  }
}

/** Run one script in a fresh project. */
async function run(
  script: string,
  args: string[],
  apiUrl: string,
  opts: { token?: string; curlrc?: string; env?: Record<string, string> } = {},
): Promise<{ code: number; out: string; curlLog: string }> {
  const dir = await Deno.makeTempDir({ prefix: "cloud-curl-" });
  try {
    const scripts = join(dir, ".specnaut", "scripts", "backlog");
    await Deno.mkdir(scripts, { recursive: true });
    await Deno.mkdir(join(dir, ".specnaut", "scripts", "bash"));
    await Deno.mkdir(join(dir, ".bin"));
    for await (const f of Deno.readDir(CLOUD)) {
      await Deno.copyFile(join(CLOUD, f.name), join(scripts, f.name));
    }
    await Deno.copyFile(RULES, join(dir, ".specnaut", "scripts", "bash", "groom-rules.sh"));
    await Deno.writeTextFile(
      join(dir, ".specnaut", "backlog-config.yml"),
      `backend: cloud\napi_url: "${apiUrl}"\nproject_key: K\n`,
    );
    await Deno.writeTextFile(join(dir, ".curlrc"), opts.curlrc ?? "");
    await Deno.writeTextFile(
      join(dir, ".bin", "curl"),
      '#!/usr/bin/env bash\nprintf "ARGS %s\\n" "$* env:${API_TOKEN:-}" >> curl.log\nexec "$REAL_CURL" "$@"\n',
    );
    await Deno.writeTextFile(join(dir, ".token"), `${opts.token ?? TOKEN}\n`);
    await Deno.writeTextFile(join(dir, ".bin", "specnaut"), "#!/usr/bin/env bash\ncat .token\n");
    const { code, stdout, stderr } = await new Deno.Command("bash", {
      args: [
        "-c",
        'export REAL_CURL=$(command -v curl) HOME="$PWD" PATH="$PWD/.bin:$PATH"; ' +
        'chmod +x .bin/*; s=$1; shift; exec bash ".specnaut/scripts/backlog/$s" "$@"',
        "driver",
        script,
        ...args,
      ],
      cwd: dir,
      env: opts.env,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const dec = new TextDecoder();
    return {
      code,
      out: dec.decode(stdout) + dec.decode(stderr),
      curlLog: await Deno.readTextFile(join(dir, "curl.log")).catch(() => ""),
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

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
      assertStringIncludes(out, "redirected the request", script);
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
