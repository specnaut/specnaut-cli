import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { walk } from "@std/fs";
import { join, relative } from "@std/path";
import {
  BACKENDS,
  type Project,
  project,
  type Result,
  SCRIPTS,
} from "./backlog_tracker_fixture.ts";

/**
 * The arguments every backend's writers share — a positional body or
 * `--body-file <path>` in its place, and `--parent <num>` — are read by one
 * parser, `_backlog_args.sh`, installed beside the backend's scripts. An
 * argument a writer would not record is refused, with nothing sent.
 */

/** The writers that take a shared argument, on every backend that has them. */
const SHARED = BACKENDS.flatMap((b) => [`${b}/add.sh`, `${b}/clarify-comment.sh`]).concat(
  "github/close.sh",
  "gitlab/close.sh",
);

/** What a writer's own copy of the parse carries: a case arm for a shared flag, or its refusal. */
const OWN_PARSE = /^\s*(--body-file|--parent)\)|--body-file needs a file/m;

/** Any call that reaches a tracker, as the stand-ins log it. */
const SENT = /^(gh|glab|curl)\t/m;

Deno.test("every writer reads its shared arguments through _backlog_args.sh", async () => {
  for (const script of SHARED) {
    const text = await Deno.readTextFile(join(SCRIPTS, script));
    assertStringIncludes(text, '. "$(dirname "$0")/_backlog_args.sh"', script);
    assert(!OWN_PARSE.test(text), `${script} parses a shared flag itself`);
  }
});

/** A writer's own copy of loading the body, or of putting texts NUL-ended into JSON. */
const OWN_BODY = /require_clean_file body|split\("\\u0000"\)|printf '%s\\0'/;

Deno.test("the body is loaded, and texts put into JSON, in _backlog_args.sh alone", async () => {
  const own: string[] = [];
  for await (const e of walk(SCRIPTS, { exts: [".sh"], includeDirs: false })) {
    if (e.name === "_backlog_args.sh") continue;
    if (OWN_BODY.test(await Deno.readTextFile(e.path))) own.push(relative(SCRIPTS, e.path));
  }
  assertEquals(own, [], "call read_body and texts_json (_backlog_args.sh)");
});

/** The positionals each add.sh records: a title, a body, and labels where it has them. */
const RECORDED: Record<string, number> = { github: 3, gitlab: 3, local: 2, cloud: 2 };

for (const backend of BACKENDS) {
  Deno.test(`${backend}: an argument a writer would not record is refused, nothing sent`, async () => {
    const p = await project(backend);
    try {
      const extra = Array.from({ length: RECORDED[backend] + 1 }, (_, i) => `arg${i}`);
      for (
        const [script, args, said] of [
          ["add.sh", extra, `'arg${RECORDED[backend]}' would not be recorded`],
          ["add.sh", ["A title", "--bogus"], "unknown flag '--bogus'"],
          ["clarify-comment.sh", ["7", "a question", "more"], "'more' would not be recorded"],
        ] as const
      ) {
        const r = await p.run(script, [...args]);
        assertEquals(r.code, 2, `${script} ${args.join(" ")}\n${r.stdout}${r.stderr}`);
        assertStringIncludes(r.stderr, said, script);
        assertStringIncludes(r.stderr, "usage:", script);
        assert(!SENT.test(r.calls), r.calls);
      }
      if (backend === "local" || backend === "cloud") {
        const r = await p.run("add.sh", ["A title", "", "bug"]);
        assertStringIncludes(r.stderr, "no labels field", backend);
      }
    } finally {
      await p.cleanup();
    }
  });
}

/** Everything a call left behind: what reached a tracker, and every local item file. */
async function recorded(p: Project, r: Result): Promise<string> {
  let files = "";
  for await (const f of Deno.readDir(join(p.dir, ".specnaut", "backlog"))) {
    if (f.isFile) files += await p.read(`.specnaut/backlog/${f.name}`);
  }
  return [r.calls, r.raw, ...r.bodies, files].join("\n");
}

for (const backend of BACKENDS) {
  Deno.test(`${backend}: a flag given twice, or a text past --body-file, is refused for that reason`, async () => {
    const p = await project(backend);
    try {
      await p.write("body.md", "A body.\n");
      for (
        const [script, args, said] of [
          [
            "clarify-comment.sh",
            ["7", "--body-file", "body.md", "more"],
            "'more' would not be recorded",
          ],
          ["add.sh", ["A title", "--parent", "3", "--parent", "4"], "--parent given twice"],
          [
            "add.sh",
            ["A title", "--body-file", "body.md", "--body-file", "body.md"],
            "--body-file given twice",
          ],
        ] as const
      ) {
        const r = await p.run(script, [...args]);
        assertEquals(r.code, 2, `${script} ${args.join(" ")}\n${r.stdout}${r.stderr}`);
        assertStringIncludes(r.stderr, said, script);
        assert(!SENT.test(r.calls), r.calls);
      }
    } finally {
      await p.cleanup();
    }
  });

  Deno.test(`${backend}: only the first argument asks for help; \`--\` ends the options`, async () => {
    const p = await project(backend);
    try {
      for (const args of [["A title", "-h"], ["--", "--a dashed title"], ["--", "-h"]]) {
        const r = await p.run("add.sh", args);
        assertEquals(r.code, 0, `add.sh ${args.join(" ")}\n${r.stdout}${r.stderr}`);
        assert(!r.stdout.includes("usage:"), `add.sh ${args.join(" ")} printed the help`);
      }
      const r = await p.run("add.sh", ["--", "--a dashed title"]);
      assertStringIncludes(await recorded(p, r), "--a dashed title");
      const help = await p.run("add.sh", ["-h"]);
      assertEquals(help.code, 0, "-h first still asks for help");
      assertStringIncludes(help.stdout, "usage:", "-h first still asks for help");
    } finally {
      await p.cleanup();
    }
  });
}
