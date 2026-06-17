import { assertEquals } from "@std/assert";
import { parseKanbanURL } from "../../src/domain/backlog_strategies/kanban_url_parser.ts";

Deno.test("parseKanbanURL parses GitHub org-owned project URL", () => {
  const r = parseKanbanURL("https://github.com/orgs/mkrlabs/projects/6");
  assertEquals(r, {
    kind: "github",
    owner: "mkrlabs",
    ownerType: "org",
    projectNumber: 6,
  });
});

Deno.test("parseKanbanURL parses GitHub user-owned project URL", () => {
  const r = parseKanbanURL("https://github.com/users/alice/projects/12");
  assertEquals(r, {
    kind: "github",
    owner: "alice",
    ownerType: "user",
    projectNumber: 12,
  });
});

Deno.test("parseKanbanURL parses gitlab.com project URL", () => {
  const r = parseKanbanURL("https://gitlab.com/mygroup/myproject");
  assertEquals(r, {
    kind: "gitlab",
    host: "gitlab.com",
    projectPath: "mygroup/myproject",
  });
});

Deno.test("parseKanbanURL parses self-hosted GitLab URL", () => {
  const r = parseKanbanURL("https://gitlab.example.com/team/repo");
  assertEquals(r, {
    kind: "gitlab",
    host: "gitlab.example.com",
    projectPath: "team/repo",
  });
});

Deno.test("parseKanbanURL accepts /views/<N> suffix on org-owned project URL", () => {
  // GitHub's address bar always appends /views/<M> when viewing a Project V2.
  const r = parseKanbanURL(
    "https://github.com/orgs/confeature/projects/1/views/1",
  );
  assertEquals(r, {
    kind: "github",
    owner: "confeature",
    ownerType: "org",
    projectNumber: 1,
  });
});

Deno.test("parseKanbanURL accepts /views/<N> suffix on user-owned project URL", () => {
  const r = parseKanbanURL(
    "https://github.com/users/alice/projects/12/views/7",
  );
  assertEquals(r, {
    kind: "github",
    owner: "alice",
    ownerType: "user",
    projectNumber: 12,
  });
});

Deno.test("parseKanbanURL rejects unknown trailing segment (not /views/)", () => {
  // Only /views/<M> is tolerated — guard against accidentally loosening too far.
  assertEquals(
    parseKanbanURL("https://github.com/orgs/mkrlabs/projects/6/settings/1"),
    null,
  );
  assertEquals(
    parseKanbanURL("https://github.com/orgs/mkrlabs/projects/6/extra"),
    null,
  );
  assertEquals(
    parseKanbanURL(
      "https://github.com/orgs/mkrlabs/projects/6/views/1/anything",
    ),
    null,
  );
});

Deno.test("parseKanbanURL trims whitespace", () => {
  const r = parseKanbanURL("  https://github.com/orgs/mkrlabs/projects/6  ");
  assertEquals(r, {
    kind: "github",
    owner: "mkrlabs",
    ownerType: "org",
    projectNumber: 6,
  });
});

Deno.test("parseKanbanURL rejects malformed GitHub project URL (missing /projects/<N>)", () => {
  assertEquals(parseKanbanURL("https://github.com/orgs/mkrlabs"), null);
  assertEquals(parseKanbanURL("https://github.com/orgs/mkrlabs/projects"), null);
});

Deno.test("parseKanbanURL rejects bare GitHub repo URL (not a project board)", () => {
  // /orgs/ or /users/ prefix is required for github.com
  assertEquals(parseKanbanURL("https://github.com/specnaut/specnaut-cli"), null);
});

Deno.test("parseKanbanURL rejects non-numeric project number", () => {
  assertEquals(
    parseKanbanURL("https://github.com/orgs/mkrlabs/projects/abc"),
    null,
  );
  assertEquals(
    parseKanbanURL("https://github.com/orgs/mkrlabs/projects/1abc"),
    null,
  );
});

Deno.test("parseKanbanURL rejects zero / negative project number", () => {
  assertEquals(
    parseKanbanURL("https://github.com/orgs/mkrlabs/projects/0"),
    null,
  );
});

Deno.test("parseKanbanURL rejects unknown ownership prefix on github.com", () => {
  assertEquals(
    parseKanbanURL("https://github.com/teams/mkrlabs/projects/6"),
    null,
  );
});

Deno.test("parseKanbanURL rejects nested GitLab group (3+ segments)", () => {
  assertEquals(
    parseKanbanURL("https://gitlab.com/group/subgroup/project"),
    null,
  );
});

Deno.test("parseKanbanURL rejects GitLab single segment", () => {
  assertEquals(parseKanbanURL("https://gitlab.com/justone"), null);
});

Deno.test("parseKanbanURL rejects garbage input", () => {
  assertEquals(parseKanbanURL("not a url"), null);
  assertEquals(parseKanbanURL(""), null);
  assertEquals(parseKanbanURL("ftp://github.com/orgs/x/projects/1"), null);
});
