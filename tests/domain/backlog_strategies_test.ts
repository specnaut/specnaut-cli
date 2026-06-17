import { assertEquals, assertThrows } from "@std/assert";
import { LocalBacklogStrategy } from "../../src/domain/backlog_strategies/local.ts";
import { GithubBacklogStrategy } from "../../src/domain/backlog_strategies/github.ts";
import { GitlabBacklogStrategy } from "../../src/domain/backlog_strategies/gitlab.ts";
import { CloudBacklogStrategy } from "../../src/domain/backlog_strategies/cloud.ts";
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

// ── CloudBacklogStrategy ────────────────────────────────────────────────────

Deno.test("CloudBacklogStrategy exposes key 'cloud'", () => {
  assertEquals(new CloudBacklogStrategy().key, "cloud");
});

Deno.test("CloudBacklogStrategy displayName mentions Specnaut Cloud", () => {
  const dn = new CloudBacklogStrategy().displayName;
  assertEquals(dn.includes("Specnaut Cloud"), true);
});

Deno.test("CloudBacklogStrategy.initConfigStub has backend + api_url + project_key, no secret", () => {
  const stub = new CloudBacklogStrategy().initConfigStub();
  assertEquals(typeof stub, "string");
  if (typeof stub !== "string") return;
  assertEquals(stub.includes("backend: cloud"), true);
  assertEquals(stub.includes("api_url:"), true);
  assertEquals(stub.includes("project_key:"), true);
  // The token is never written to the config — it lives in the credential store.
  assertEquals(stub.includes("api_token:"), false);
});

Deno.test("CloudBacklogStrategy.initConfigMessages points to `cloud login`", () => {
  const msgs = new CloudBacklogStrategy().initConfigMessages();
  assertEquals(msgs.length >= 2, true);
  const joined = msgs.join("\n");
  assertEquals(joined.includes("backlog-config.yml"), true);
  assertEquals(joined.includes("cloud login"), true);
});

// ── Stub population from Kanban URL (#147) ─────────────────────────────────

Deno.test(
  "GithubBacklogStrategy.initConfigStub fills repo + project_number when ctx provides url + repo",
  () => {
    const stub = new GithubBacklogStrategy().initConfigStub({
      url: {
        kind: "github",
        owner: "mkrlabs",
        ownerType: "org",
        projectNumber: 6,
      },
      repo: "specnaut/specnaut-cli",
    });
    assertEquals(typeof stub, "string");
    assertEquals(stub.includes(`repo: "specnaut/specnaut-cli"`), true);
    assertEquals(stub.includes(`project_number: "6"`), true);
    // No "Fill in" reminder when the populated stub is rendered
    assertEquals(stub.includes("Fill in"), false);
  },
);

Deno.test(
  "GithubBacklogStrategy.initConfigStub falls back to empty stub when repo is missing",
  () => {
    const stub = new GithubBacklogStrategy().initConfigStub({
      url: {
        kind: "github",
        owner: "mkrlabs",
        ownerType: "org",
        projectNumber: 6,
      },
    });
    // No repo → empty stub, even if URL is present
    assertEquals(stub.includes(`repo: ""`), true);
    assertEquals(stub.includes("Fill in"), true);
  },
);

Deno.test(
  "GitlabBacklogStrategy.initConfigStub fills host + project_id from URL",
  () => {
    const stub = new GitlabBacklogStrategy().initConfigStub({
      url: {
        kind: "gitlab",
        host: "gitlab.example.com",
        projectPath: "team/repo",
      },
    });
    assertEquals(stub.includes(`host: gitlab.example.com`), true);
    assertEquals(stub.includes(`project_id: "team/repo"`), true);
    assertEquals(stub.includes("Fill in"), false);
  },
);

Deno.test(
  "GithubBacklogStrategy.initConfigMessages says 'ready to run' when ctx is populated",
  () => {
    const msgs = new GithubBacklogStrategy().initConfigMessages({
      url: {
        kind: "github",
        owner: "mkrlabs",
        ownerType: "org",
        projectNumber: 6,
      },
      repo: "specnaut/specnaut-cli",
    });
    const joined = msgs.join("\n");
    assertEquals(joined.includes("ready to run /backlog"), true);
    assertEquals(joined.includes("specnaut/specnaut-cli"), true);
    assertEquals(joined.includes("project #6"), true);
    assertEquals(joined.includes("fill in"), false);
  },
);

Deno.test(
  "GitlabBacklogStrategy.initConfigMessages references the parsed host/project when populated",
  () => {
    const msgs = new GitlabBacklogStrategy().initConfigMessages({
      url: {
        kind: "gitlab",
        host: "gitlab.example.com",
        projectPath: "team/repo",
      },
    });
    const joined = msgs.join("\n");
    assertEquals(joined.includes("gitlab.example.com/team/repo"), true);
    assertEquals(joined.includes("ready to run /backlog"), true);
  },
);

Deno.test("strategies still return valid stubs when called with no argument", () => {
  // Backward-compat: existing call sites passing no ctx.
  const gh = new GithubBacklogStrategy().initConfigStub();
  const gl = new GitlabBacklogStrategy().initConfigStub();
  assertEquals(gh.includes(`repo:`), true);
  assertEquals(gl.includes(`project_id:`), true);
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

Deno.test("findBacklogStrategy returns the cloud strategy for 'cloud'", () => {
  assertEquals(findBacklogStrategy("cloud").key, "cloud");
});

Deno.test("findBacklogStrategy throws on an unknown backend", () => {
  assertThrows(
    () => findBacklogStrategy("bitbucket" as never),
    Error,
    "unknown backlog backend",
  );
});
