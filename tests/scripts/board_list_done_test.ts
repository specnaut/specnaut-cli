import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

/**
 * cli#602 — `list.sh Done` was empty by construction.
 *
 * The script queried `gh issue list --state open` unconditionally and then
 * filtered the rows by their Project V2 `Status`. So `Done` could only ever
 * return items that were **both** carded `Done` **and** still open as issues.
 * On any board where finishing work means closing the issue, that intersection
 * is empty: nothing printed, exit 0 — silence indistinguishable from an empty
 * column, and a grooming sweep that walks the columns under-reporting `Done`
 * without ever saying so.
 *
 * This does not need GitHub's built-in "Auto-close issue" workflow. Project #1
 * has those workflows **disabled** and showed the defect anyway, because
 * Specnaut's own close contract closes the issue as it moves the card — the
 * product's prescribed way of finishing work is alone sufficient to trigger it.
 * The fixture therefore encodes the invariant (a `Done` card may be a closed
 * issue), not a workflow.
 *
 * **The asymmetry is the point, so both halves are pinned.** Widening every
 * column to `--state all` would green the first test here and silently break
 * grooming: `Backlog` / `Ready` / `In progress` / `In review` would start
 * returning issues closed as `not planned`, and issues whose card never moved
 * off its column before being closed — exactly the rows a sweep must not read
 * as live work. So the tests below assert what each filter asks gh for, not
 * only what it prints.
 */

const GITHUB_DIR = "../../templates/core/skills/board/scripts/github";

function scriptPath(rel: string): string {
  return fromFileUrl(new URL(rel, import.meta.url));
}

/** Two open issues in working columns, one closed issue carded `Done`. */
const OPEN_ROWS = [
  { number: 1, title: "an open ready item", projectItems: [{ status: { name: "Ready" } }] },
  { number: 2, title: "an open backlog item", projectItems: [{ status: { name: "Backlog" } }] },
];
const CLOSED_DONE_ROW = {
  number: 3,
  title: "a shipped item, closed",
  projectItems: [{ status: { name: "Done" } }],
};
/** A closed issue whose card never left `Backlog` — the row grooming must not see. */
const CLOSED_STALE_ROW = {
  number: 4,
  title: "closed as not planned, card never moved",
  projectItems: [{ status: { name: "Backlog" } }],
};

async function stubbedProject(): Promise<string> {
  const tmp = await Deno.makeTempDir({ prefix: "board-list-done-" });
  const scripts = `${tmp}/board/scripts/github`;
  await Deno.mkdir(scripts, { recursive: true });
  await Deno.mkdir(`${tmp}/.specnaut`, { recursive: true });
  await Deno.mkdir(`${tmp}/bin`, { recursive: true });

  for (const name of ["_config.sh", "list.sh"]) {
    await Deno.copyFile(scriptPath(`${GITHUB_DIR}/${name}`), `${scripts}/${name}`);
    await Deno.chmod(`${scripts}/${name}`, 0o755);
  }
  await Deno.writeTextFile(
    `${tmp}/.specnaut/backlog-config.yml`,
    'repo: "acme/my-app"\nproject_number: 7\n',
  );

  // The stub honours `--state` exactly as gh does — that is what makes the
  // first test capable of failing. A stub that returned every row regardless
  // would print the Done item even from an `--state open` query, and the
  // regression would pass against the unfixed script.
  await Deno.writeTextFile(
    `${tmp}/bin/gh`,
    `#!/usr/bin/env bash
echo "\$*" >> "${tmp}/gh-calls.log"
state=""
prev=""
for a in "\$@"; do
  if [ "\$prev" = "--state" ]; then state="\$a"; fi
  prev="\$a"
done
case "\$state" in
  open)   cat <<'JSON'
${JSON.stringify(OPEN_ROWS)}
JSON
;;
  closed) cat <<'JSON'
${JSON.stringify([CLOSED_DONE_ROW, CLOSED_STALE_ROW])}
JSON
;;
  all)    cat <<'JSON'
${JSON.stringify([...OPEN_ROWS, CLOSED_DONE_ROW, CLOSED_STALE_ROW])}
JSON
;;
  *) echo "stub: unexpected --state '\$state' in: \$*" >&2; exit 1 ;;
esac
`,
  );
  await Deno.chmod(`${tmp}/bin/gh`, 0o755);
  return tmp;
}

async function list(tmp: string, args: string[]) {
  const { code, stdout, stderr } = await new Deno.Command("bash", {
    args: [`${tmp}/board/scripts/github/list.sh`, ...args],
    env: { PATH: `${tmp}/bin:${Deno.env.get("PATH")}` },
    clearEnv: false,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
    calls: await Deno.readTextFile(`${tmp}/gh-calls.log`).catch(() => ""),
  };
}

Deno.test("list.sh Done returns items whose issue is closed", async () => {
  const tmp = await stubbedProject();
  try {
    const r = await list(tmp, ["Done"]);
    assertEquals(r.code, 0, r.stderr);

    // THE regression. Before the fix this was the empty string at exit 0.
    assert(
      r.stdout.includes("#3"),
      "the shipped Done item is missing — `list.sh Done` still answers silence " +
        `on a board whose Done cards are closed issues. Got:\n${r.stdout}`,
    );
    assert(
      r.stdout.includes("Done"),
      "the row is present but not reported under its Status",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("a closed issue whose card never left Backlog is not reported as Backlog", async () => {
  // The cost of the obvious fix. `--state all` everywhere would surface #4 —
  // closed, but carded `Backlog` — as live work in the grooming sweep.
  const tmp = await stubbedProject();
  try {
    const r = await list(tmp, ["Backlog"]);
    assertEquals(r.code, 0, r.stderr);
    assert(r.stdout.includes("#2"), `the open backlog item is missing:\n${r.stdout}`);
    assert(
      !r.stdout.includes("#4"),
      "a closed issue is being reported as live Backlog work — the Done fix " +
        "widened a working column it must not touch",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("only the Done filter widens the issue-state query", async () => {
  // Asserting on the request, not just the rows: a future refactor could keep
  // these outputs right by post-filtering while still spending the `--limit`
  // budget on closed history, and the row assertions alone would not notice.
  for (const args of [[], ["Ready"], ["Backlog"], ["In progress"], ["In review"]]) {
    const tmp = await stubbedProject();
    try {
      const r = await list(tmp, args);
      assertEquals(r.code, 0, `${JSON.stringify(args)}: ${r.stderr}`);
      assert(
        r.calls.includes("--state open"),
        `${JSON.stringify(args)} asked gh for something other than open issues: ${r.calls}`,
      );
      assert(
        !r.calls.includes("--state all") && !r.calls.includes("--state closed"),
        `${JSON.stringify(args)} widened the query beyond open issues: ${r.calls}`,
      );
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  }

  const tmp = await stubbedProject();
  try {
    const r = await list(tmp, ["Done"]);
    assert(
      r.calls.includes("--state all"),
      `Done must list both states — a Done card is not guaranteed closed: ${r.calls}`,
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
