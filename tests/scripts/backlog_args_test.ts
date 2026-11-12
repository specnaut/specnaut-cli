import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { BACKENDS, project, SCRIPTS } from "./backlog_tracker_fixture.ts";

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
