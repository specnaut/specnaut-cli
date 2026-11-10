import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  type Backend,
  localItem,
  type Project,
  project,
  SCRIPTS,
} from "./backlog_tracker_fixture.ts";
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
 * `text_refusal` in `_backlog_plan.sh`, run here from a real install; every
 * script that sends a title, body, comment or label to a tracker asks it before
 * its first tracker call or file write, and is driven here through its own
 * entry point with the tracker CLIs replaced by stand-ins.
 */

/** How a writer takes one text field: as an argument, or as a file it reads. */
interface Way {
  field: string;
  argv?: (text: string) => string[];
  file?: (path: string) => string[];
}

const add = (labels: boolean): Way[] => [
  { field: "title", argv: (t) => [t, "Body."] },
  {
    field: "body",
    argv: (t) => [CLEAN_TITLE, t],
    file: (f) => [CLEAN_TITLE, "--body-file", f],
  },
  ...(labels ? [{ field: "label", argv: (t: string) => [CLEAN_TITLE, "Body.", t] }] : []),
];
const edit: Way[] = [
  { field: "title", argv: (t) => ["1", "--title", t] },
  { field: "append", file: (f) => ["1", "--append-file", f] },
];
const comment: Way[] = [
  { field: "body", argv: (t) => ["1", t], file: (f) => ["1", "--body-file", f] },
];
const close: Way[] = [{ field: "body", file: (f) => ["1", "--body-file", f] }];
const label: Way[] = [{ field: "label", argv: (t) => ["1", "bug", t] }];

/** How to call each writer. Which scripts are writers is computed below, never listed. */
const WAYS: Record<string, Way[]> = {
  "github/add.sh": add(true),
  "gitlab/add.sh": add(true),
  "cloud/add.sh": add(false),
  "local/add.sh": add(false),
  "github/edit.sh": edit,
  "gitlab/edit.sh": edit,
  "local/edit.sh": edit,
  "github/clarify-comment.sh": comment,
  "gitlab/clarify-comment.sh": comment,
  "cloud/clarify-comment.sh": comment,
  "local/clarify-comment.sh": comment,
  "github/close.sh": close,
  "gitlab/close.sh": close,
  "github/label.sh": label,
  "gitlab/label.sh": label,
};

/** A script that sends caller text names it in its usage: these spellings. */
const SENDS_TEXT = /--body-file|--append-file|--title|"<title>"|"<question>"|<label>/;

async function writers(): Promise<string[]> {
  const found: string[] = [];
  for (const backend of ["cloud", "github", "gitlab", "local"]) {
    for await (const f of Deno.readDir(join(SCRIPTS, backend))) {
      if (!f.name.endsWith(".sh") || f.name === "apply-plan.sh") continue;
      const text = await Deno.readTextFile(join(SCRIPTS, backend, f.name));
      if (SENDS_TEXT.test(text)) found.push(`${backend}/${f.name}`);
    }
  }
  return found.sort();
}

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
  } catch { /* no index yet: the snapshot is the files alone */ }
  return out.sort().join("\0");
}

async function setUp(backend: Backend): Promise<Project> {
  const p = await project(backend);
  if (backend === "local") {
    await p.write(".specnaut/backlog/001-first.md", localItem("001", "First"));
  }
  return p;
}

Deno.test("the backlog writers are exactly the scripts whose usage takes text", async () => {
  assertEquals(await writers(), Object.keys(WAYS).sort());
  assertEquals(Object.keys(WAYS).length, 15);
});

for (const backend of ["github", "gitlab", "cloud", "local"] as const) {
  Deno.test(`every ${backend} backlog writer refuses a secret-shaped text and writes nothing`, async () => {
    const p = await setUp(backend);
    let k = backend.length; // a different rotation per backend
    try {
      const before = await snapshot(p);
      for (const w of WAYS_OF(backend)) {
        for (const viaFile of [false, true]) {
          const make = viaFile ? w.way.file : w.way.argv;
          if (!make) continue;
          const s = POOL[k++ % POOL.length];
          await p.write("text.md", s.text);
          const r = await p.run(w.name, make(viaFile ? join(p.dir, "text.md") : s.text), s.env);
          const seen = `${w.script} ${w.way.field} ${
            JSON.stringify(s.text)
          }\n${r.stdout}${r.stderr}`;
          assertEquals([r.code, r.stderr], [14, `REFUSED ${s.cls} ${w.way.field}\n`], seen);
          assertEquals(r.calls, "", seen);
          assert(!r.stdout.includes(s.text) && !r.stderr.includes(s.text), seen);
          assertEquals(await snapshot(p), before, seen);
        }
      }
      // A NUL in a file is refused hidden, though no argument could carry it.
      await p.write("text.md", "a\u0000b");
      for (const w of WAYS_OF(backend)) {
        if (!w.way.file) continue;
        const r = await p.run(w.name, w.way.file(join(p.dir, "text.md")));
        assertEquals(
          [r.code, r.stderr, r.calls],
          [14, `REFUSED hidden ${w.way.field}\n`, ""],
          w.script,
        );
      }
      // No scan installed: every writer stops with status 2, refusing nothing by name.
      await Deno.remove(join(p.dir, ".specnaut/scripts/bash/_report_text.sh"));
      for (const w of WAYS_OF(backend)) {
        const args = w.way.argv ? w.way.argv("plain words") : w.way.file!(join(p.dir, "text.md"));
        const r = await p.run(w.name, args);
        assertEquals([r.code, r.calls], [2, ""], `${w.script}\n${r.stderr}`);
        assert(!r.stderr.includes("REFUSED"), r.stderr);
      }
      assertEquals(await snapshot(p), before);
    } finally {
      await p.cleanup();
    }
  });

  Deno.test(`every ${backend} backlog writer sends clean text byte for byte`, async () => {
    const p = await setUp(backend);
    try {
      for (const w of WAYS_OF(backend)) {
        const text = ({ title: CLEAN_TITLE, label: "tech-debt" } as Record<string, string>)[
          w.way.field
        ] ??
          CLEAN_BODY;
        for (const viaFile of [false, true]) {
          // A fresh local backlog each time: an earlier call's text must not answer for this one.
          const q = backend === "local" ? await setUp(backend) : p;
          try {
            await q.write("text.md", text);
            const args = viaFile ? w.way.file?.(join(q.dir, "text.md")) : w.way.argv?.(text);
            if (!args) continue;
            const r = await q.run(w.name, args);
            assertEquals(r.code, 0, `${w.script} ${w.way.field}\n${r.stdout}${r.stderr}`);
            const sent = backend === "local" ? await snapshot(q) : r.raw;
            assert(
              reached(sent, text),
              `${w.script} ${w.way.field}: not sent as written\n${r.raw}`,
            );
          } finally {
            if (q !== p) await q.cleanup();
          }
        }
      }
    } finally {
      await p.cleanup();
    }
  });
}

function WAYS_OF(backend: Backend) {
  return Object.entries(WAYS).filter(([s]) => s.startsWith(`${backend}/`)).flatMap((
    [script, ways],
  ) => ways.map((way) => ({ script, name: script.slice(backend.length + 1), way })));
}

/** The text arrived intact: inside an argument or a body file, or as a string of a JSON payload. */
function reached(sent: string, text: string): boolean {
  if (sent.includes(text)) return true;
  return sent.split("\0").some((a) => {
    try {
      return Object.values(JSON.parse(a)).includes(text);
    } catch {
      return false;
    }
  });
}
