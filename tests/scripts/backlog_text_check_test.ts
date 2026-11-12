import { assert, assertEquals, assertMatch } from "@std/assert";
import { join } from "@std/path";
import { type Backend, localItem, type Project, project } from "./backlog_tracker_fixture.ts";
import { WAYS, waysOf, type Writer, writers } from "./backlog_writer_ways.ts";
import {
  CLEAN_BODY,
  CLEAN_TITLE,
  ENV_VALUE,
  HIDDEN_SAMPLES,
  SECRET_NAMES,
  SECRET_SAMPLES,
} from "./secret_samples.ts";

/**
 * A backlog write never sends text the secret scan refuses. The rule is
 * `text_refusal` in `_clean_text.sh`, run here from a real install; every
 * script that sends a title, body, comment or label to a tracker asks it before
 * its first tracker call or file write, and is driven here through its own
 * entry point with the tracker CLIs replaced by stand-ins.
 */

/** Every refused sample an argument can carry (no NUL), with its class; one is refused only by the environment. */
const POOL: { text: string; cls: string; env?: Record<string, string> }[] = [
  ...SECRET_SAMPLES.map((text) => ({ text, cls: "secret" })),
  ...HIDDEN_SAMPLES.filter((t) => !t.includes("\0")).map((text) => ({ text, cls: "hidden" })),
  {
    text: `see ${ENV_VALUE} here`,
    cls: "secret",
    env: { [SECRET_NAMES[0]]: ENV_VALUE },
  },
];

/** A `tr` that fails reading a text (the NUL mapping), and is the real one for any other call. */
const BROKEN_READ = String.raw`#!/usr/bin/env bash
[ "$1" != '\000' ] || exit 1
exec /usr/bin/tr "$@"
`;

/** The task files and index a local write changes; empty on a remote backend. */
async function snapshot(p: Project): Promise<string> {
  const out: string[] = [];
  const walk = async (rel: string) => {
    for await (const e of Deno.readDir(join(p.dir, rel))) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory) await walk(r);
      else out.push(`${r}\n${await p.read(r)}`);
    }
  };
  await walk(".specnaut/backlog");
  try {
    out.push(await p.read(".specnaut/backlog.md"));
  } catch (e) {
    // No index yet: the snapshot is the files alone. Any other error is the test's.
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  return out.sort().join("\0");
}

async function setUp(backend: Backend): Promise<Project> {
  const p = await project(backend);
  if (backend === "local") {
    await p.write(".specnaut/backlog/001-first.md", localItem("001", "First"));
  }
  return p;
}

/** The clean text a writer's field takes: a title, a label, or a body. */
function cleanText(field: string): string {
  if (field === "title") return CLEAN_TITLE;
  return field === "label" ? "tech-debt" : CLEAN_BODY;
}

/** Each way of each writer, given the next refused sample: refused by class, nothing sent or written. */
async function assertSamplesRefused(p: Project, backend: Backend) {
  const before = await snapshot(p);
  let k = backend.length; // a different rotation per backend
  for (const w of waysOf(backend)) {
    for (const viaFile of [false, true]) {
      const make = viaFile ? w.way.file : w.way.argv;
      if (!make) continue;
      const s = POOL[k++ % POOL.length];
      await p.write("text.md", s.text);
      const r = await p.run(w.name, make(viaFile ? join(p.dir, "text.md") : s.text), s.env);
      const seen = `${w.script} ${w.way.field} ${JSON.stringify(s.text)}\n${r.stdout}${r.stderr}`;
      assertEquals(
        [r.code, r.stderr, r.calls],
        [14, `REFUSED ${s.cls} ${w.way.field}\n`, ""],
        seen,
      );
      assert(!r.stdout.includes(s.text) && !r.stderr.includes(s.text), seen);
      assertEquals(await snapshot(p), before, seen);
    }
  }
}

/**
 * Every writer, given plain words, stops with status 2 and the one line `why`
 * on stderr (from whichever script judged the text): nothing refused by name,
 * nothing sent, nothing written.
 */
async function assertEveryWriterStops(p: Project, backend: Backend, why: string) {
  const before = await snapshot(p);
  await p.write("text.md", "plain words");
  for (const w of waysOf(backend)) {
    const args = w.way.argv ? w.way.argv("plain words") : w.way.file!(join(p.dir, "text.md"));
    const r = await p.run(w.name, args);
    assertEquals([r.code, r.calls], [2, ""], `${w.script}\n${r.stderr}`);
    assertMatch(r.stderr, new RegExp(`^[a-z-]+\\.sh: ${why}\\n$`), w.script);
  }
  assertEquals(await snapshot(p), before);
}

/** One way of one writer, given clean text in a fresh project: the text reaches the tracker or task file intact. */
async function assertSentAsWritten(backend: Backend, w: Writer, viaFile: boolean) {
  // A fresh project each time: an earlier call's text must not answer for this one.
  const p = await setUp(backend);
  try {
    const text = cleanText(w.way.field);
    await p.write("text.md", text);
    const args = viaFile ? w.way.file!(join(p.dir, "text.md")) : w.way.argv!(text);
    const r = await p.run(w.name, args);
    assertEquals(r.code, 0, `${w.script} ${w.way.field}\n${r.stdout}${r.stderr}`);
    // A remote body travels off the command line (stdin or a body file): it counts as sent too.
    const sent = backend === "local" ? await snapshot(p) : [r.raw, ...r.bodies].join("\0");
    assert(reached(sent, text), `${w.script} ${w.way.field}: not sent as written\n${r.raw}`);
  } finally {
    await p.cleanup();
  }
}

/** `check` run against a fresh project of `backend`, removed afterwards. */
async function withProject(backend: Backend, check: (p: Project) => Promise<void>) {
  const p = await setUp(backend);
  try {
    await check(p);
  } finally {
    await p.cleanup();
  }
}

Deno.test("the backlog writers are exactly the scripts whose usage takes text", async () => {
  assertEquals(await writers(), Object.keys(WAYS).sort());
  assertEquals(Object.keys(WAYS).length, 15);
});

for (const backend of ["github", "gitlab", "cloud", "local"] as const) {
  Deno.test(`every ${backend} backlog writer refuses a secret-shaped text and writes nothing`, () =>
    withProject(backend, (p) => assertSamplesRefused(p, backend)));

  Deno.test(`every ${backend} backlog writer refuses a NUL in a text file as hidden`, () =>
    withProject(backend, async (p) => {
      // No argument could carry it; a file can.
      await p.write("text.md", "a\u0000b");
      for (const w of waysOf(backend)) {
        if (!w.way.file) continue;
        const r = await p.run(w.name, w.way.file(join(p.dir, "text.md")));
        const want = [14, `REFUSED hidden ${w.way.field}\n`, ""];
        assertEquals([r.code, r.stderr, r.calls], want, w.script);
      }
    }));

  Deno.test(`every ${backend} backlog writer stops when no secret scan is installed`, () =>
    withProject(backend, async (p) => {
      await Deno.remove(join(p.dir, ".specnaut/scripts/bash/_report_text.sh"));
      await assertEveryWriterStops(p, backend, "the secret scan is missing");
    }));

  Deno.test(`every ${backend} backlog writer stops when its text cannot be read`, () =>
    withProject(backend, async (p) => {
      // A `tr` that fails on the scan's own read, and only there.
      await p.write("bin/tr", BROKEN_READ);
      await assertEveryWriterStops(p, backend, "the text could not be read");
    }));

  Deno.test(`every ${backend} backlog writer sends clean text byte for byte`, async () => {
    for (const w of waysOf(backend)) {
      for (const viaFile of [false, true]) {
        if (viaFile ? w.way.file : w.way.argv) await assertSentAsWritten(backend, w, viaFile);
      }
    }
  });
}

/** The text arrived intact: inside an argument, a body file or a request body, or as a string of a JSON payload. */
function reached(sent: string, text: string): boolean {
  if (sent.includes(text)) return true;
  return sent.split("\0").some((a) => {
    try {
      return Object.values(JSON.parse(a) ?? {}).includes(text);
    } catch (e) {
      // Most arguments are not JSON; only a parse error means "not this one".
      if (e instanceof SyntaxError) return false;
      throw e;
    }
  });
}
