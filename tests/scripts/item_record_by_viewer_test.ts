import { assertEquals } from "@std/assert";
import { project } from "./backlog_tracker_fixture.ts";
import { ghIssue, ghProject } from "./apply_plan_fixture.ts";

/**
 * A remote `item-record.sh` never writes `author: null` beside
 * `by_viewer: null`. That pair is the local backend's own text, the one
 * exception groom-rules.sh grants the groom marker; a remote comment whose
 * author is gone (a deleted account) reads `by_viewer: false` instead.
 */

const who = (r: { author: unknown; by_viewer: unknown }) => [r.author, r.by_viewer];

Deno.test("github: an issue or comment with no author is not the viewer's", async () => {
  const issue = ghIssue("T");
  const node = issue.data.repository.issue as Record<string, unknown>;
  Object.assign(node, {
    author: null,
    viewerDidAuthor: null,
    comments: {
      nodes: [
        { body: "x", author: null, authorAssociation: "NONE", viewerDidAuthor: null },
        { body: "y", author: { login: "me" }, authorAssociation: "OWNER", viewerDidAuthor: null },
      ],
    },
  });
  const p = await ghProject({ 7: issue });
  try {
    const out = await p.run("item-record.sh", ["7"]);
    assertEquals(out.code, 0, out.stderr);
    const rec = JSON.parse(out.stdout);
    assertEquals(who(rec), [null, false]);
    assertEquals(rec.comments.map(who), [[null, false], ["me", null]]);
  } finally {
    await p.cleanup();
  }
});

Deno.test("gitlab: an issue or note with no author is not the viewer's, the viewer known or not", async () => {
  const p = await project("gitlab");
  try {
    await p.write(
      "issue.json",
      JSON.stringify({
        iid: 4,
        title: "T",
        description: "B",
        labels: [],
        state: "opened",
        author: null,
      }),
    );
    await p.write("notes.json", JSON.stringify([{ body: "x", system: false, author: null }]));
    const glab = (user: string) =>
      p.write(
        "bin/glab",
        `#!/usr/bin/env bash
case "$1 $2" in
  "api user") ${user} ;;
  "issue view") cat "$FAKE_ROOT/issue.json" ;;
  api*) cat "$FAKE_ROOT/notes.json" ;;
esac
`,
      );
    for (const user of ["echo '{\"id\":1}'", "exit 1"]) {
      await glab(user);
      const out = await p.run("item-record.sh", ["4"]);
      assertEquals(out.code, 0, out.stderr);
      const rec = JSON.parse(out.stdout);
      assertEquals([who(rec), rec.comments.map(who)], [[null, false], [[null, false]]], user);
    }
  } finally {
    await p.cleanup();
  }
});
