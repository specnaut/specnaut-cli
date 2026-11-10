import { assert, assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs/exists";
import { BACKENDS, localItem, project } from "./backlog_tracker_fixture.ts";

/**
 * `add.sh` and `clarify-comment.sh` take their text from a file
 * (`--body-file <path>`) beside the positional argument they already had, so a
 * caller never has to quote free text into a command line. The text arrives at
 * the tracker byte for byte and is never read by a shell on the way.
 */

const TEXT = "Run `touch tick` and $(touch dollar); --repo=acme/other 'quoted'";

/** The argument that follows `flag` in the one logged call to `tool sub`. */
function argAfter(calls: string, call: string, flag: string): string | undefined {
  const line = calls.split("\n").find((l) => l.startsWith(call));
  assert(line, `no ${call.replaceAll("\t", " ")} call:\n${calls}`);
  const f = line.split("\t");
  const i = f.indexOf(flag);
  return i < 0 ? undefined : f[i + 1];
}

/** No shell expanded the text: neither of its commands ran. */
async function noneRan(dir: string) {
  assert(!(await exists(join(dir, "tick"))), "a backtick in the text ran");
  assert(!(await exists(join(dir, "dollar"))), "a $( ) in the text ran");
}

Deno.test("github: --body-file hands gh the path, never the text", async () => {
  const p = await project("github");
  try {
    await p.write("body.md", TEXT);
    const add = await p.run("add.sh", ["A title", "--body-file", "body.md"]);
    assertEquals(add.code, 0, add.stderr);
    // gh is handed a private copy of the file, the bytes the secret check judged.
    assertMatch(
      argAfter(add.calls, "gh\tissue\tcreate", "--body-file") ?? "",
      /backlog-text\.[^/]+\/body$/,
    );
    assertStringIncludes(add.raw, `${TEXT}\0`);
    const note = await p.run("clarify-comment.sh", ["7", "--body-file", "body.md"]);
    assertEquals(note.code, 0, note.stderr);
    assertMatch(
      argAfter(note.calls, "gh\tissue\tcomment\t7", "--body-file") ?? "",
      /backlog-text\.[^/]+\/body$/,
    );
    assertStringIncludes(note.raw, `${TEXT}\0`);
    for (const r of [add, note]) assert(!r.calls.includes("touch"), r.calls);
  } finally {
    await p.cleanup();
  }
});

Deno.test("gitlab: --body-file text reaches glab as one argument, unexpanded", async () => {
  const p = await project("gitlab");
  try {
    await p.write("body.md", TEXT);
    const add = await p.run("add.sh", ["A title", "--body-file", "body.md"]);
    assertEquals(add.code, 0, add.stderr);
    assertEquals(argAfter(add.calls, "glab\tissue\tcreate", "--description"), TEXT);
    const note = await p.run("clarify-comment.sh", ["7", "--body-file", "body.md"]);
    assertEquals(note.code, 0, note.stderr);
    assertEquals(argAfter(note.calls, "glab\tissue\tnote\t7", "--message"), TEXT);
    await noneRan(p.dir);
  } finally {
    await p.cleanup();
  }
});

Deno.test("cloud: --body-file text travels in the JSON payload, unexpanded", async () => {
  const p = await project("cloud");
  try {
    await p.write("body.md", TEXT);
    const add = await p.run("add.sh", ["A title", "--body-file", "body.md"]);
    assertEquals(add.code, 0, add.stdout + add.stderr);
    assertEquals(JSON.parse(argAfter(add.calls, "curl", "-d")!).body, TEXT);
    const note = await p.run("clarify-comment.sh", ["7", "--body-file", "body.md"]);
    assertEquals(note.code, 0, note.stdout + note.stderr);
    assertEquals(JSON.parse(argAfter(note.calls, "curl", "-d")!).body, TEXT);
    await noneRan(p.dir);
  } finally {
    await p.cleanup();
  }
});

Deno.test("local: --body-file text lands in the item file, unexpanded", async () => {
  const p = await project("local");
  try {
    await p.write("body.md", TEXT);
    const add = await p.run("add.sh", ["A title", "--body-file", "body.md"]);
    assertEquals(add.code, 0, add.stderr);
    assertStringIncludes(await p.read(".specnaut/backlog/001-a-title.md"), `\n${TEXT}\n`);
    await p.write(".specnaut/backlog/007-other.md", localItem("007", "Other"));
    const note = await p.run("clarify-comment.sh", ["7", "--body-file", "body.md"]);
    assertEquals(note.code, 0, note.stderr);
    assertStringIncludes(await p.read(".specnaut/backlog/007-other.md"), `\n${TEXT}\n`);
    await noneRan(p.dir);
  } finally {
    await p.cleanup();
  }
});

/** merge-close.md posts its close comment this way, with no product-owner dispatch. */
for (
  const [backend, note, flag] of [["github", "comment", "--body-file"], [
    "gitlab",
    "note",
    "--message",
  ]] as const
) {
  Deno.test(`${backend}: close.sh --body-file comments from the file, then closes`, async () => {
    const p = await project(backend);
    try {
      await p.write("body.md", TEXT);
      const r = await p.run("close.sh", ["7", "completed", "--body-file", "body.md"]);
      assertEquals(r.code, 0, r.stderr);
      const tool = backend === "github" ? "gh" : "glab";
      const sent = argAfter(r.calls, `${tool}\tissue\t${note}\t7`, flag);
      if (backend === "github") {
        assertMatch(sent ?? "", /backlog-text\.[^/]+\/body$/);
        assertStringIncludes(r.raw, `${TEXT}\0`);
      } else assertEquals(sent, TEXT);
      const order = r.calls.split("\n").map((l) => l.split("\t").slice(0, 3).join(" "));
      assert(
        order.indexOf(`${tool} issue ${note}`) < order.indexOf(`${tool} issue close`),
        r.calls,
      );
      await noneRan(p.dir);
      const missing = await p.run("close.sh", ["7", "completed", "--body-file", "missing.md"]);
      assertEquals(missing.code, 2, missing.stderr);
      assert(!/issue\tclose/.test(missing.calls), missing.calls);
    } finally {
      await p.cleanup();
    }
  });
}

for (const backend of BACKENDS) {
  Deno.test(`${backend}: --body-file without a file, or beside a body, is a usage error`, async () => {
    const p = await project(backend);
    try {
      await p.write("body.md", TEXT);
      for (
        const [script, args] of [
          ["add.sh", ["A title", "--body-file", "missing.md"]],
          ["add.sh", ["A title", "--body-file"]],
          ["add.sh", ["A title", "a body", "--body-file", "body.md"]],
          ["clarify-comment.sh", ["7", "--body-file", "missing.md"]],
          ["clarify-comment.sh", ["7", "--body-file"]],
        ] as const
      ) {
        const r = await p.run(script, [...args]);
        assertEquals(r.code, 2, `${script} ${args.join(" ")}\n${r.stderr}`);
        assert(!/issue\tcreate|issue\tcomment|issue\tnote|^curl/m.test(r.calls), r.calls);
      }
    } finally {
      await p.cleanup();
    }
  });
}
