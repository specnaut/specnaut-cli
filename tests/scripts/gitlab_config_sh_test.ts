import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { GitlabBacklogStrategy } from "../../src/domain/backlog_strategies/gitlab.ts";
import type { ParsedKanbanURL } from "../../src/domain/backlog_strategies/kanban_url_parser.ts";

/**
 * The gitlab backlog scripts' `_config.sh` hands `host:` to glab as GITLAB_HOST, the host glab
 * signs its requests for. It must read the config `specnaut init` writes (quoted or not, an
 * inline comment, maybe CRLF), and take a host glab reaches over https only: a bare host (glab's
 * default scheme is https), an https URL, or plain http to a loopback host alone.
 */

const CONFIG_SH = fromFileUrl(
  new URL("../../templates/core/skills/task/scripts/gitlab/_config.sh", import.meta.url),
);

/** Sources `_config.sh`, then prints the host glab would be given. */
const PROBE = 'printf "GITLAB_HOST=%s|\\n" "$GITLAB_HOST"';

/** Source the installed `_config.sh` in a project holding `config`, then run `probe`. */
async function source(config: string, probe = PROBE): Promise<{ code: number; out: string }> {
  const dir = await Deno.makeTempDir({ prefix: "gitlab-config-sh-" });
  try {
    const scripts = join(dir, ".specnaut", "scripts", "backlog");
    await Deno.mkdir(scripts, { recursive: true });
    await Deno.writeTextFile(join(dir, ".specnaut", "backlog-config.yml"), config);
    await Deno.copyFile(CONFIG_SH, join(scripts, "_config.sh"));
    const script = ["#!/usr/bin/env bash", 'source "$(dirname "$0")/_config.sh"', probe, ""];
    await Deno.writeTextFile(join(scripts, "probe.sh"), script.join("\n"));
    const { code, stdout, stderr } = await new Deno.Command("bash", {
      args: [".specnaut/scripts/backlog/probe.sh"],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const dec = new TextDecoder();
    return { code, out: dec.decode(stdout) + dec.decode(stderr) };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const withHost = (host: string) => `host: ${host}\nproject_id: "acme/my-app"\n`;

Deno.test("gitlab _config.sh reads the host `specnaut init` writes, LF or CRLF", async () => {
  const strategy = new GitlabBacklogStrategy();
  const url: ParsedKanbanURL = {
    kind: "gitlab",
    host: "gitlab.example.com",
    projectPath: "acme/my-app",
  };
  const populated = strategy.initConfigStub({ url });
  // The empty stub, once its project_id is filled in, keeps its commented host line.
  const filled = strategy.initConfigStub().replace('project_id: ""', 'project_id: "7"');
  for (const [config, host] of [[populated, "gitlab.example.com"], [filled, "gitlab.com"]]) {
    for (const text of [config, config.replaceAll("\n", "\r\n")]) {
      const r = await source(text);
      assertEquals([r.code, r.out], [0, `GITLAB_HOST=${host}|\n`]);
    }
  }
});

Deno.test("gitlab _config.sh takes a host glab reaches over https, or plain http to loopback", async () => {
  for (
    const host of [
      "gitlab.example.com",
      "gitlab.example.com:8443",
      '"https://gitlab.example.com"',
      "https://gitlab.example.com:8443/gitlab/",
      "'https://gitlab.example.com'",
      "http://localhost:8080",
      "http://127.0.0.1",
      "http://[::1]:3000/",
    ]
  ) {
    const r = await source(withHost(host));
    assertEquals([r.code, r.out], [0, `GITLAB_HOST=${host.replace(/^["']|["']$/g, "")}|\n`]);
  }
});

Deno.test("gitlab _config.sh refuses any other host, and glab is never given it", async () => {
  for (
    const host of [
      "http://gitlab.example.com",
      "HTTP://gitlab.example.com",
      "http://localhost.example.com",
      "http://127.0.0.1.example.com",
      "http://localhost@gitlab.example.com",
      "ftp://gitlab.example.com",
      "https://user@gitlab.example.com",
      "https://gitlab.example.com?x=1",
      "https://gitlab.example.com#x",
      "https://",
      "//gitlab.example.com",
      '"gitlab.example.com other.example.com"',
    ]
  ) {
    const r = await source(withHost(host));
    assertEquals(r.code, 2, `${host}: ${r.out}`);
    assertStringIncludes(r.out, "error: backlog-config.yml host", host);
    assertEquals(r.out.includes("GITLAB_HOST="), false, host);
  }
});

Deno.test("gitlab item_url links a bare host over https, the scheme glab reaches it with", async () => {
  for (
    const [host, base] of [
      ["gitlab.example.com", "https://gitlab.example.com"],
      ["https://gitlab.example.com/", "https://gitlab.example.com"],
      ["http://localhost:8080", "http://localhost:8080"],
    ]
  ) {
    const r = await source(withHost(host), "item_url 42");
    assertEquals([r.code, r.out], [0, `${base}/acme/my-app/-/issues/42\n`]);
  }
});
