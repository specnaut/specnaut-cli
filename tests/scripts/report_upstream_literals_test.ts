import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { git } from "../templates/hooks/hook_sandbox.ts";
import { box } from "./report_upstream_fixture.ts";

/**
 * cli#726: what the machine knows the project is called. A refusal names the kind
 * of literal, so the user can be told, and never the value.
 */

const report = (value: string) => `A title\n\n## Summary\n\nbefore ${value} after\n`;

const KINDS = [
  ["zorgblat", "home"],
  ["ZORGBLAT", "home"],
  ["rocket-launcher", "directory"],
  ["Ada Quux", "git-user"],
  ["ada@corp.invalid", "git-user"],
  ["acme-corp", "remote"],
  ["widgets", "remote"],
  ["git.example.org", "remote"],
];

Deno.test("each kind of literal refuses under its own name, the value not printed", async () => {
  const b = await box({ dir: "rocket-launcher" });
  try {
    await git(b.sb, b.project, "init", "-q");
    await git(
      b.sb,
      b.project,
      "remote",
      "add",
      "origin",
      "git@git.example.org:acme-corp/widgets.git",
    );
    await git(b.sb, b.project, "config", "user.name", "Ada Quux");
    await git(b.sb, b.project, "config", "user.email", "ada@corp.invalid");
    for (const [value, kind] of KINDS) {
      const r = await b.run(["prepare", "--kind", "bug"], report(value));
      assertEquals(r.stdout, `REFUSED literal ${kind}\n`, value);
    }
    // Whole word: a longer word holding one is not that word.
    const near = await b.run(["prepare", "--kind", "bug"], report("zorgblatting widgetsmith"));
    assertStringIncludes(near.stdout, "DIGEST ");
  } finally {
    await b.cleanup();
  }
});

Deno.test("the hostname is a literal, whole and short", async () => {
  const b = await box();
  try {
    await b.shim("hostname", "echo build-node-7.corp.invalid");
    for (const value of ["build-node-7", "build-node-7.corp.invalid"]) {
      const r = await b.run(["prepare", "--kind", "bug"], report(value));
      assertEquals(r.stdout, "REFUSED literal hostname\n", value);
    }
  } finally {
    await b.cleanup();
  }
});

Deno.test("below $HOME every directory segment is a literal; elsewhere the last alone", async () => {
  const under = await box({ dir: "home/clients/acme/rocket" });
  try {
    for (const value of ["clients", "acme", "rocket"]) {
      const r = await under.run(["prepare", "--kind", "bug"], report(value));
      assertEquals(r.stdout, "REFUSED literal directory\n", value);
    }
  } finally {
    await under.cleanup();
  }
  const outside = await box({ dir: "clients/rocket" });
  try {
    const r = await outside.run(["prepare", "--kind", "bug"], report("rocket"));
    assertEquals(r.stdout, "REFUSED literal directory\n");
    const parent = await outside.run(["prepare", "--kind", "bug"], report("clients"));
    assertStringIncludes(parent.stdout, "DIGEST ");
  } finally {
    await outside.cleanup();
  }
});

Deno.test("the toplevel counts from a subdirectory, and below $HOME by every segment", async () => {
  const b = await box({ dir: "home/clients/rocket/deeper" });
  try {
    await git(b.sb, join(b.project, ".."), "init", "-q");
    for (const value of ["clients", "rocket", "deeper"]) {
      const r = await b.run(["prepare", "--kind", "bug"], report(value));
      assertEquals(r.stdout, "REFUSED literal directory\n", value);
    }
  } finally {
    await b.cleanup();
  }
  const plain = await box({ dir: "rocket/deeper" });
  try {
    await git(plain.sb, join(plain.project, ".."), "init", "-q");
    const r = await plain.run(["prepare", "--kind", "bug"], report("rocket"));
    assertEquals(r.stdout, "REFUSED literal directory\n");
  } finally {
    await plain.cleanup();
  }
});

Deno.test("a remote gives up its host and every path segment, in any URL form", async () => {
  const forms = [
    "https://gitlab.example/acme/platform/widgets.git",
    "ssh://git@gitlab.example:2222/acme/platform/widgets.git",
    "git@gitlab.example:acme/platform/widgets.git",
  ];
  for (const url of forms) {
    const b = await box();
    try {
      await git(b.sb, b.project, "init", "-q");
      await git(b.sb, b.project, "remote", "add", "upstream", url);
      for (const value of ["gitlab.example", "acme", "platform", "widgets"]) {
        const r = await b.run(["prepare", "--kind", "bug"], report(value));
        assertEquals(r.stdout, "REFUSED literal remote\n", `${value} of ${url}`);
      }
    } finally {
      await b.cleanup();
    }
  }
});

Deno.test("a `_` hides no name, and the stoplist still lets a plain word through", async () => {
  const b = await box({ dir: "src" });
  try {
    const hidden = await b.run(["prepare", "--kind", "bug"], report("ZORGBLAT_BILLING"));
    assertEquals(hidden.stdout, "REFUSED literal home\n");
    const word = await b.run(["prepare", "--kind", "bug"], report("the src folder"));
    assertStringIncludes(word.stdout, "DIGEST ");
  } finally {
    await b.cleanup();
  }
});

Deno.test("generic folders and Specnaut's own coordinates carry no signal: the stoplist", async () => {
  const b = await box({ dir: "home/Sites/apps/specnaut-cli" });
  try {
    await git(b.sb, b.project, "init", "-q");
    await git(
      b.sb,
      b.project,
      "remote",
      "add",
      "origin",
      "https://github.com/specnaut/specnaut-cli",
    );
    const text = "specnaut-cli on github.com, specnaut in sites and apps";
    assertStringIncludes(
      (await b.run(["prepare", "--kind", "bug"], report(text))).stdout,
      "DIGEST ",
    );
  } finally {
    await b.cleanup();
  }
});

Deno.test("backlog-config's repo, host, project_id, project_key and api_url are literals", async () => {
  const b = await box();
  try {
    await Deno.mkdir(join(b.project, ".specnaut"));
    await Deno.writeTextFile(
      join(b.project, ".specnaut", "backlog-config.yml"),
      'repo: "acme/my-app" # the project\nhost: "https://gitlab.corp.invalid"\n' +
        'project_id: "team-x/sub-y"\nproject_key: "ROCKET"\napi_url: "https://api.tracker.invalid"\n',
    );
    const values = ["acme/my-app", "my-app", "acme", "gitlab.corp.invalid", "team-x", "sub-y"];
    for (const value of [...values, "ROCKET", "api.tracker.invalid"]) {
      const r = await b.run(["prepare", "--kind", "bug"], report(value));
      assertEquals(r.stdout, "REFUSED literal backlog-repo\n", value);
    }
  } finally {
    await b.cleanup();
  }
});

Deno.test("SC-008: no backlog config runs; one pointing elsewhere is never addressed", async () => {
  const b = await box();
  try {
    const none = await b.prepared();
    assertEquals((await b.run(["create", none], "", { STUB_CREATE_OUT: "x" })).code, 5);
    assertStringIncludes(await b.log(), "--repo specnaut/specnaut-cli");

    await Deno.mkdir(join(b.project, ".specnaut"));
    await Deno.writeTextFile(
      join(b.project, ".specnaut", "backlog-config.yml"),
      'repo: "acme/my-app"\nproject_number: 7\n',
    );
    const again = await b.prepared("Another title\n\nAnother body.\n");
    await b.run(["create", again], "", {
      STUB_CREATE_OUT: "https://github.com/specnaut/specnaut-cli/issues/5",
      STUB_VIEW_OUT: "5\\n",
    });
    const log = await b.log();
    assertStringIncludes(log, "argv=issue view 5 --repo specnaut/specnaut-cli");
    assertEquals(log.includes("acme"), false, "the project's repository was addressed");
  } finally {
    await b.cleanup();
  }
});
