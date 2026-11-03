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
