import { join } from "@std/path";
import { type Backend, SCRIPTS } from "./backlog_tracker_fixture.ts";
import { CLEAN_TITLE } from "./secret_samples.ts";

/**
 * How each backlog writer takes the text it sends: which field, as an argument
 * or as a file it reads. Which scripts are writers is computed from their usage
 * (`writers`), never listed by hand.
 */

/** How a writer takes one text field: as an argument, or as a file it reads. */
export interface Way {
  field: string;
  argv?: (text: string) => string[];
  file?: (path: string) => string[];
}

/** One way of one writer: its path under the backend, its file name, the way. */
export interface Writer {
  script: string;
  name: string;
  way: Way;
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

/** How to call each writer. */
export const WAYS: Record<string, Way[]> = {
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

/** Every installed script, on every backend, whose usage takes text. */
export async function writers(): Promise<string[]> {
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

/** Every way of every writer of `backend`. */
export function waysOf(backend: Backend): Writer[] {
  return Object.entries(WAYS)
    .filter(([s]) => s.startsWith(`${backend}/`))
    .flatMap(([script, ways]) =>
      ways.map((way) => ({ script, name: script.slice(backend.length + 1), way }))
    );
}
