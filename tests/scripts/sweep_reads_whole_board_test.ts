import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/**
 * A read that stops at its cap says nothing about the rest. The GitHub sweep
 * read the board with `--limit 500`, so a larger board scanned 500 items and
 * reported `drifted 0` over the others — and the `scanned 0` guard could not
 * see it, the count was not zero. The GitLab twin asked for `--per-page 500`,
 * which the API serves as 100: the sweep and the cascade gate both judged the
 * first hundred issues as if they were all.
 *
 * Every case here is a board that does not fit in one read. The GitHub ones
 * must refuse (exit 4, no summary line); the GitLab ones must page and find
 * what sits past the first page.
 */

const SCRIPTS = fromFileUrl(
  new URL("../../templates/core/skills/task/scripts/", import.meta.url),
);

type Files = Record<string, unknown>;

/**
 * Run `script` from `backend` in the installed layout, against a stub that
 * answers from `files`: `gh` serves `items` / `closed` / `open`, `glab` serves
 * `<closed|open|children>-<page>` and `[]` past the last page — or always page
 * 1 when `IGNORE_PAGE` is set, as a glab without `--page` would.
 */
async function run(
  backend: "github" | "gitlab",
  script: string,
  files: Files,
  { args = [] as string[], ignorePage = false } = {},
) {
  const dir = await Deno.makeTempDir({ prefix: `whole-board-${backend}-` });
  try {
    const fix = join(dir, "fix");
    await Deno.mkdir(fix);
    for (const [name, body] of Object.entries(files)) {
      await Deno.writeTextFile(join(fix, `${name}.json`), JSON.stringify(body));
    }
    const bin = join(dir, "bin");
    await Deno.mkdir(bin);
    const gh = `#!/usr/bin/env bash
case "$*" in
  *"project item-list"*) cat "$FIX/items.json" ;;
  *"--state closed"*)    cat "$FIX/closed.json" ;;
  *"issue list"*)        cat "$FIX/open.json" ;;
  *) exit 1 ;;
esac
`;
    const glab = `#!/usr/bin/env bash
case "$*" in *"issue view"*) printf '{"state":"opened"}\\n'; exit 0 ;; esac
kind=open; page=1; prev=""
for a in "$@"; do
  [ "$a" = "--closed" ] && kind=closed
  case "$a" in parent::*) kind=children ;; esac
  [ "$prev" = "--page" ] && page="$a"
  prev="$a"
done
[ -n "\${IGNORE_PAGE:-}" ] && page=1
f="$FIX/$kind-$page.json"
if [ -f "$f" ]; then cat "$f"; else printf '[]'; fi
`;
    await Deno.writeTextFile(join(bin, "gh"), gh);
    await Deno.writeTextFile(join(bin, "glab"), glab);
    await Deno.chmod(join(bin, "gh"), 0o755);
    await Deno.chmod(join(bin, "glab"), 0o755);

    const scripts = join(dir, ".specnaut", "scripts", "backlog");
    await Deno.mkdir(scripts, { recursive: true });
    for await (const e of Deno.readDir(join(SCRIPTS, backend))) {
      if (e.isFile) await Deno.copyFile(join(SCRIPTS, backend, e.name), join(scripts, e.name));
    }
    await Deno.writeTextFile(
      join(dir, ".specnaut", "backlog-config.yml"),
      backend === "github"
        ? "repo: acme/widgets\nproject_number: 1\n"
        : "host: gitlab.com\nproject_id: acme/widgets\n",
    );

    const out = await new Deno.Command("bash", {
      args: [join(scripts, script), ...args],
      env: {
        PATH: `${bin}:${Deno.env.get("PATH")}`,
        HOME: dir,
        FIX: fix,
        ...(ignorePage ? { IGNORE_PAGE: "1" } : {}),
      },
      clearEnv: true,
    }).output();
    const dec = new TextDecoder();
    return { code: out.code, out: dec.decode(out.stdout), err: dec.decode(out.stderr) };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const card = (number: number, status: string) => ({
  status,
  content: { type: "Issue", number, repository: "acme/widgets" },
});
const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);

/** A refusal: exit 4, the reason, and no summary line to be read as a verdict. */
function assertRefused(r: { code: number; out: string; err: string }, says: string) {
  assertEquals(r.code, 4, `${r.out}${r.err}`);
  assertStringIncludes(r.err, says);
  assertStringIncludes(r.err, "refusing to report a board state this run only partly saw");
  assert(!/^scanned \d+/m.test(r.out), `a summary was printed over a partial read:\n${r.out}`);
}

// ───────────────────────────────── GitHub ─────────────────────────────────

Deno.test("sweep [github]: a board read short of its totalCount is refused", async () => {
  // The card that drifted is the one the read never reached.
  const r = await run("github", "sweep-closed.sh", {
    items: { items: [card(1, "Ready")], totalCount: 2 },
    closed: [2],
    open: [1],
  });
  assertRefused(r, "read 1 of the 2 items on Project #1");
});

Deno.test("sweep [github]: a board read with no totalCount is refused", async () => {
  const r = await run("github", "sweep-closed.sh", {
    items: { items: [card(1, "Ready")] },
    closed: [],
    open: [1],
  });
  assertRefused(r, "returned no totalCount");
});

Deno.test("sweep [github]: an open-issue list that fills its cap is refused", async () => {
  const r = await run("github", "sweep-closed.sh", {
    items: { items: [card(1, "Ready")], totalCount: 1 },
    closed: [],
    open: range(1, 5000),
  });
  assertRefused(r, "open issue list for acme/widgets filled the 5000 cap");
});

Deno.test("sweep [github]: a closed-issue search that fills GitHub's 1000 is refused", async () => {
  const r = await run("github", "sweep-closed.sh", {
    items: { items: [card(1, "Ready")], totalCount: 1 },
    closed: range(1, 1000),
    open: [],
  });
  assertRefused(r, "recently closed issue list for acme/widgets filled the 1000 cap");
});

Deno.test("sweep [github]: a complete read just under the caps still reports", async () => {
  // The other side: the guard must not refuse a board it did read whole.
  const r = await run("github", "sweep-closed.sh", {
    items: { items: [card(1, "Ready"), card(2, "Done")], totalCount: 2 },
    closed: [...range(1000, 998), 1],
    open: range(2, 4999),
  });
  assertEquals(r.code, 0, `${r.out}${r.err}`);
  assertStringIncludes(r.out, "scanned 2, drifted 1, reopened 1");
});

// ───────────────────────────────── GitLab ─────────────────────────────────

const issue = (iid: number, status: string, closed = false) => ({
  iid,
  labels: [`Status::${status}`],
  ...(closed ? { closed_at: "2999-01-01T00:00:00Z" } : {}),
});
const page = (from: number, n: number, status: string, closed = false) =>
  range(from, n).map((i) => issue(i, status, closed));

Deno.test("sweep [gitlab]: drift past the first hundred issues is found", async () => {
  const r = await run("gitlab", "sweep-closed.sh", {
    "closed-1": page(1, 100, "Done", true),
    "closed-2": [issue(101, "Ready", true)],
    "open-1": page(200, 100, "Ready"),
    "open-2": [issue(300, "Done")],
  });
  assertEquals(r.code, 0, `${r.out}${r.err}`);
  assertStringIncludes(r.out, "DRIFTED  101 Ready");
  assertStringIncludes(r.out, "REOPENED 300");
  assertStringIncludes(r.out, "scanned 202, drifted 1, reopened 1");
});

Deno.test("sweep [gitlab]: pages that overlap are refused, not looped on", async () => {
  // A glab that ignores --page serves page 1 forever.
  const r = await run("gitlab", "sweep-closed.sh", {
    "closed-1": page(1, 100, "Done", true),
    "open-1": [],
  }, { ignorePage: true });
  assertEquals(r.code, 4, `${r.out}${r.err}`);
  assertStringIncludes(r.err, "overlapped");
  assert(!/^scanned \d+/m.test(r.out), r.out);
});

Deno.test("cascade-check [gitlab]: an open child past the first hundred blocks the close", async () => {
  const closed = range(1, 100).map((iid) => ({ iid, title: `c${iid}`, state: "closed" }));
  const r = await run("gitlab", "cascade-check.sh", {
    "children-1": closed,
    "children-2": [{ iid: 101, title: "the hundred-and-first", state: "opened" }],
  }, { args: ["42"] });
  assertEquals(r.code, 11, `${r.out}${r.err}`);
  assertStringIncludes(r.out, "1 open child issue(s) of 101");
  assertStringIncludes(r.out, "#101");
});

Deno.test("cascade-check [gitlab]: overlapping child pages are not a verdict", async () => {
  const closed = range(1, 100).map((iid) => ({ iid, title: `c${iid}`, state: "closed" }));
  const r = await run("gitlab", "cascade-check.sh", { "children-1": closed }, {
    args: ["42"],
    ignorePage: true,
  });
  assertEquals(r.code, 3, `${r.out}${r.err}`);
  assert(!r.out.includes("safe to close"), r.out);
});
