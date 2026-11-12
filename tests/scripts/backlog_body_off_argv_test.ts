import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { project } from "./backlog_tracker_fixture.ts";
import { waysOf } from "./backlog_writer_ways.ts";

/**
 * The GitLab and Cloud writers send a request body off the command line —
 * glab reads it on stdin, curl from a private file — so no text is visible in
 * the process list, and a long one cannot pass the argument limit. Read back
 * from the stand-ins: what they were given as arguments, and the body.
 */

/** A text each way sends, unlike anything a script adds itself. */
const marker = (field: string) => `Marker ${field} text, quoted 'and' "so"`;

for (const backend of ["gitlab", "cloud"] as const) {
  Deno.test(`${backend}: every text a writer sends is in the request body, never an argument`, async () => {
    const p = await project(backend);
    try {
      // A label is a name GitLab's label calls take as an argument; it is no body.
      for (const w of waysOf(backend).filter((w) => w.way.field !== "label")) {
        const text = marker(w.way.field);
        const calls = [];
        if (w.way.argv) calls.push(w.way.argv(text));
        if (w.way.file) {
          await p.write("text.md", text);
          calls.push(w.way.file("text.md"));
        }
        for (const args of calls) {
          const r = await p.run(w.name, args);
          const seen = `${w.script} ${args.join(" ")}\n${r.stderr}\n${r.calls}`;
          assertEquals(r.code, 0, seen);
          assert(!r.calls.includes(text), `the text stood on a command line: ${seen}`);
          assert(r.bodies.some((b) => b.includes(JSON.stringify(text).slice(1, -1))), seen);
        }
      }
    } finally {
      await p.cleanup();
    }
  });

  Deno.test(`${backend}: a body past the argument limit is sent whole`, async () => {
    const p = await project(backend);
    try {
      // Over every platform's limit on one exec's arguments (1 MiB on macOS).
      const text = "A long body line.\n".repeat(70_000);
      await p.write("long.md", text);
      const r = await p.run("add.sh", ["A title", "--body-file", "long.md"]);
      assertEquals(r.code, 0, r.stderr.slice(0, 2000));
      const sent = JSON.parse(r.bodies.at(-1) ?? "{}");
      // A body file's trailing newlines are dropped, as they always were.
      assertEquals(sent[backend === "gitlab" ? "description" : "body"], text.trimEnd());
    } finally {
      await p.cleanup();
    }
  });
}

Deno.test("cloud: a move's request body is a file, gone once the script ends", async () => {
  const p = await project("cloud");
  try {
    const tmp = join(p.dir, "tmp");
    await Deno.mkdir(tmp);
    const r = await p.run("move.sh", ["7", "In Progress"], { TMPDIR: tmp });
    assertEquals(r.code, 0, r.stderr);
    assert(!/\t(-d|--data|--data-raw)\t/.test(r.calls), r.calls);
    assertStringIncludes(r.calls, "\t--data-binary\t@");
    assertEquals(JSON.parse(r.bodies[0]), { projectKey: "K", number: 7, status: "In Progress" });
    assertEquals([...Deno.readDirSync(tmp)], [], "a request body was left behind");
  } finally {
    await p.cleanup();
  }
});
