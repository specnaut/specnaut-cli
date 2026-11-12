import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { normalizeApiUrl, renderCloudConfig } from "../../src/domain/cloud/cloud_config.ts";

/**
 * The cloud backlog scripts' `_config.sh` hands `api_url` to curl, which is not
 * the URL parser the CLI judges it with. It must read the config the CLI writes
 * (quoted, an inline comment, maybe CRLF), and pass nothing two parsers could
 * read as different hosts.
 */

const CONFIG_SH = fromFileUrl(
  new URL("../../templates/core/skills/task/scripts/cloud/_config.sh", import.meta.url),
);

/** Sources `_config.sh`; the stub records what the CLI was asked, and stands in for its token. */
const PROBE = [
  "#!/usr/bin/env bash",
  'specnaut() { printf "%s\\n" "$*" >> calls.log; echo tok; }',
  'source "$(dirname "$0")/_config.sh"',
  'printf "API_URL=%s\\n" "$API_URL"',
  "",
].join("\n");

/** Source the installed `_config.sh` in a project holding `config`; `specnaut` is stubbed. */
async function source(
  config: string,
  probe = PROBE,
): Promise<{ code: number; out: string; calls: string }> {
  const dir = await Deno.makeTempDir({ prefix: "cloud-config-sh-" });
  try {
    const scripts = join(dir, ".specnaut", "scripts", "backlog");
    await Deno.mkdir(scripts, { recursive: true });
    await Deno.writeTextFile(join(dir, ".specnaut", "backlog-config.yml"), config);
    await Deno.copyFile(CONFIG_SH, join(scripts, "_config.sh"));
    await Deno.copyFile(join(CONFIG_SH, "../../_issue_text.sh"), join(scripts, "_issue_text.sh"));
    await Deno.writeTextFile(join(scripts, "probe.sh"), probe);
    const { code, stdout, stderr } = await new Deno.Command("bash", {
      args: [".specnaut/scripts/backlog/probe.sh"],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const calls = await Deno.readTextFile(join(dir, "calls.log")).catch((e) => {
      if (e instanceof Deno.errors.NotFound) return ""; // the stub was never called
      throw e;
    });
    const dec = new TextDecoder();
    return { code, out: dec.decode(stdout) + dec.decode(stderr), calls };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("cloud _config.sh reads the api_url the CLI itself writes, LF or CRLF", async () => {
  const rendered = renderCloudConfig("https://api.specnaut.com", "CLOUD");
  for (const config of [rendered, rendered.replaceAll("\n", "\r\n")]) {
    const r = await source(config);
    assertEquals(r.code, 0, r.out);
    assertStringIncludes(r.out, "API_URL=https://api.specnaut.com\n");
    assertEquals(r.calls, "cloud token --api-url https://api.specnaut.com\n");
  }
});

Deno.test("cloud _config.sh reads a single-quoted or a bare api_url, an inline comment dropped", async () => {
  for (
    const line of [
      "api_url: 'https://cloud.example.com/'",
      "api_url: https://cloud.example.com/   # mine",
    ]
  ) {
    const r = await source(`backend: cloud\n${line}\nproject_key: CLOUD\n`);
    assertEquals(r.code, 0, r.out);
    assertStringIncludes(r.out, "API_URL=https://cloud.example.com/\n");
  }
});

Deno.test("cloud _config.sh refuses an api_url two URL parsers could read as different hosts", async () => {
  for (
    const url of [
      "https://api.specnaut.com\\@collector.invalid",
      "https://user:pw@collector.invalid",
      "https://api.specnaut.com?x=1",
      "https://api.specnaut.com#frag",
      "file:///etc/passwd",
    ]
  ) {
    const r = await source(`backend: cloud\napi_url: "${url}"\nproject_key: CLOUD\n`);
    assertEquals(r.code, 2, `${url}\n${r.out}`);
    assertStringIncludes(r.out, "is not a plain http(s) URL", url);
    assertEquals(r.calls, "", `the CLI was never asked for a token for ${url}`);
  }
});

Deno.test("a legitimate URL with a port passes both guards, unchanged", async () => {
  const url = "https://cloud.example.test:8443/base";
  assertEquals(normalizeApiUrl(url), url);
  const r = await source(`backend: cloud\napi_url: "${url}"\nproject_key: CLOUD\n`);
  assertEquals(r.code, 0, r.out);
  assertEquals(r.out, `API_URL=${url}\n`);
  assertEquals(r.calls, `cloud token --api-url ${url}\n`);
});

// One grammar in two languages: a string they judge differently is a hole, whichever is laxer.
Deno.test("cloud _config.sh and normalizeApiUrl agree on what a plain API base is", async () => {
  for (
    const url of [
      "https://api.specnaut.com",
      "https://api.specnaut.com/",
      "https://cloud.example.com/base/v1",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://127.0.0.1.:3000",
      "https://api.specnaut.com.",
      "https://a..b",
      "https://api.specnaut.com\\@collector.invalid",
      "https://user:pw@collector.invalid",
      "https://collector.invalid?x=1",
      "https://collector.invalid#f",
      "https://caf\u00e9.example",
      "https://a b.example",
      "file:///etc/passwd",
      "ftp://collector.invalid",
    ]
  ) {
    const r = await source(`backend: cloud\napi_url: "${url}"\nproject_key: CLOUD\n`);
    assertEquals(r.code === 0, normalizeApiUrl(url) !== null, `${url}\n${r.out}`);
  }
});

Deno.test("cloud _config.sh adds nothing to the reason `cloud token` gave for failing", async () => {
  const failing = PROBE.replace("echo tok;", 'echo "the CLI says why" >&2; return 1;');
  const r = await source(renderCloudConfig("https://api.specnaut.com", "CLOUD"), failing);
  assertEquals(r.code, 2, r.out);
  assertEquals(r.out.trim(), "the CLI says why");
});

// The key reaches every request's query string and the name of reconcile.sh's cursor file.
Deno.test("cloud _config.sh refuses a project_key that is more than a plain key", async () => {
  for (const key of ["K&number=1", "../../outside", "K#x", "K Y", "-K", "K".repeat(65)]) {
    const r = await source(
      `backend: cloud\napi_url: "https://api.specnaut.com"\nproject_key: "${key}"\n`,
    );
    assertEquals(r.code, 2, `${key}\n${r.out}`);
    assertStringIncludes(r.out, "project_key is not a plain key", key);
    assertEquals(r.calls, "", `the CLI was never asked for a token for ${key}`);
  }
  for (const key of ["K", "CLOUD", "ACME2", "my_app-1"]) {
    const r = await source(
      `backend: cloud\napi_url: "https://api.specnaut.com"\nproject_key: ${key}\n`,
    );
    assertEquals(r.code, 0, `${key}\n${r.out}`);
  }
});

// The asset is the bearer token: over plain http it crosses the network in clear,
// while loopback traffic never leaves the host.
Deno.test("cloud _config.sh refuses a plain-http api_url before a token is asked for, loopback aside", async () => {
  for (const url of ["http://cloud.example.com", "http://10.0.0.5:8080/base", "http://127.0.0.2"]) {
    const r = await source(`backend: cloud\napi_url: "${url}"\nproject_key: CLOUD\n`);
    assertEquals(r.code, 2, `${url}\n${r.out}`);
    assertStringIncludes(r.out, "api_url is plain http", url);
    assertEquals(r.calls, "", `the CLI was never asked for a token for ${url}`);
  }
  for (const url of ["http://localhost:3000", "http://127.0.0.1:3000/base", "http://[::1]:3000"]) {
    const r = await source(`backend: cloud\napi_url: "${url}"\nproject_key: CLOUD\n`);
    assertEquals(r.code, 0, `${url}\n${r.out}`);
    assertEquals(normalizeApiUrl(url), url);
  }
});
