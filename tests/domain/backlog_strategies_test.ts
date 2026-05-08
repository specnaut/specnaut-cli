import { assertEquals, assertThrows } from "@std/assert";
import { LocalBacklogStrategy } from "../../src/domain/backlog_strategies/local.ts";
import { GithubBacklogStrategy } from "../../src/domain/backlog_strategies/github.ts";
import { GitlabBacklogStrategy } from "../../src/domain/backlog_strategies/gitlab.ts";
import {
  BACKLOG_STRATEGIES,
  findBacklogStrategy,
} from "../../src/domain/backlog_strategies/registry.ts";
import { KNOWN_BACKLOG_BACKENDS } from "../../src/domain/installed_lock.ts";

// ── LocalBacklogStrategy ────────────────────────────────────────────────────

Deno.test("LocalBacklogStrategy exposes key 'local'", () => {
  assertEquals(new LocalBacklogStrategy().key, "local");
});

Deno.test("LocalBacklogStrategy displayName mentions Markdown files", () => {
  const dn = new LocalBacklogStrategy().displayName;
  assertEquals(dn.includes("Markdown") || dn.includes("markdown"), true);
});

Deno.test("LocalBacklogStrategy.initConfigStub returns null (zero-config)", () => {
  assertEquals(new LocalBacklogStrategy().initConfigStub(), null);
});

Deno.test("LocalBacklogStrategy.initConfigMessages is empty", () => {
  assertEquals(new LocalBacklogStrategy().initConfigMessages(), []);
});

// ── GithubBacklogStrategy ───────────────────────────────────────────────────

Deno.test("GithubBacklogStrategy exposes key 'github'", () => {
  assertEquals(new GithubBacklogStrategy().key, "github");
});

Deno.test("GithubBacklogStrategy displayName mentions GitHub + gh CLI", () => {
  const dn = new GithubBacklogStrategy().displayName;
  assertEquals(dn.includes("GitHub"), true);
  assertEquals(dn.includes("gh CLI"), true);
});

Deno.test("GithubBacklogStrategy.initConfigStub contains repo + project_number keys", () => {
  const stub = new GithubBacklogStrategy().initConfigStub();
  assertEquals(typeof stub, "string");
  if (typeof stub !== "string") return;
  assertEquals(stub.includes("repo:"), true);
  assertEquals(stub.includes("project_number:"), true);
});

Deno.test("GithubBacklogStrategy.initConfigMessages mentions backlog-config.yml + MCP tip", () => {
  const msgs = new GithubBacklogStrategy().initConfigMessages();
  assertEquals(msgs.length >= 2, true);
  const joined = msgs.join("\n");
  assertEquals(joined.includes("backlog-config.yml"), true);
  assertEquals(joined.includes("MCP"), true);
});

// ── GitlabBacklogStrategy ───────────────────────────────────────────────────

Deno.test("GitlabBacklogStrategy exposes key 'gitlab'", () => {
  assertEquals(new GitlabBacklogStrategy().key, "gitlab");
});

Deno.test("GitlabBacklogStrategy displayName mentions GitLab + glab CLI", () => {
  const dn = new GitlabBacklogStrategy().displayName;
  assertEquals(dn.includes("GitLab"), true);
  assertEquals(dn.includes("glab CLI"), true);
});

Deno.test("GitlabBacklogStrategy.initConfigStub contains host + project_id keys", () => {
  const stub = new GitlabBacklogStrategy().initConfigStub();
  assertEquals(typeof stub, "string");
  if (typeof stub !== "string") return;
  assertEquals(stub.includes("host:"), true);
  assertEquals(stub.includes("project_id:"), true);
});

Deno.test("GitlabBacklogStrategy.initConfigMessages mentions glab CLI prerequisite", () => {
  const msgs = new GitlabBacklogStrategy().initConfigMessages();
  assertEquals(msgs.length >= 2, true);
  const joined = msgs.join("\n");
  assertEquals(joined.includes("backlog-config.yml"), true);
  assertEquals(joined.includes("glab"), true);
});

// ── Registry ────────────────────────────────────────────────────────────────

Deno.test("BACKLOG_STRATEGIES covers every value of KNOWN_BACKLOG_BACKENDS", () => {
  const registryKeys = BACKLOG_STRATEGIES.map((s) => s.key).sort();
  const knownKeys = [...KNOWN_BACKLOG_BACKENDS].sort();
  assertEquals(registryKeys, knownKeys);
});

Deno.test("findBacklogStrategy returns the local strategy for 'local'", () => {
  assertEquals(findBacklogStrategy("local").key, "local");
});

Deno.test("findBacklogStrategy returns the github strategy for 'github'", () => {
  assertEquals(findBacklogStrategy("github").key, "github");
});

Deno.test("findBacklogStrategy returns the gitlab strategy for 'gitlab'", () => {
  assertEquals(findBacklogStrategy("gitlab").key, "gitlab");
});

Deno.test("findBacklogStrategy throws on an unknown backend", () => {
  assertThrows(
    () => findBacklogStrategy("bitbucket" as never),
    Error,
    "unknown backlog backend",
  );
});
