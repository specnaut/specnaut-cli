import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

/**
 * Behavioural tests for `github/sweep-closed.sh`.
 *
 * The other backlog-script tests in this directory assert on the script's
 * *text* — they pin which commands it calls. That convention cannot reach what
 * matters here: this script's risk is not which calls it makes but what it
 * concludes, and its worst failure produces no output at all. So these run the
 * script against a stubbed `gh` and assert on what it decides.
 *
 * Stubbing rather than restating the jq is deliberate. Re-expressing the
 * filters in the test would create a second definition of "drifted" that can
 * disagree with the first — the exact defect this whole seam exists to remove.
 */

const SCRIPT_DIR = fromFileUrl(
  new URL("../../templates/core/skills/task/scripts/github", import.meta.url),
);

type Fixture = {
  items: unknown;
  closed: number[];
  open: number[];
  /** When set, the Nth `gh issue list --state closed` call returns this instead. */
  closedOnSecondCall?: number[];
};

/** Builds a throwaway project whose `gh` is a script returning `fx`. */
async function runSweep(fx: Fixture, args: string[] = []) {
  const dir = await Deno.makeTempDir();
  const scripts = `${dir}/.specnaut/scripts/backlog`;
  await Deno.mkdir(scripts, { recursive: true });
  await Deno.writeTextFile(
    `${dir}/.specnaut/backlog-config.yml`,
    "repo: acme/widget\nproject_number: 1\n",
  );
  for (const f of ["_config.sh", "sweep-closed.sh"]) {
    await Deno.copyFile(`${SCRIPT_DIR}/${f}`, `${scripts}/${f}`);
  }

  // `gh` stub: dispatches on the sub-command the script actually uses.
  const bin = `${dir}/bin`;
  await Deno.mkdir(bin);
  await Deno.writeTextFile(
    `${bin}/gh`,
    `#!/usr/bin/env bash
STUB_STATE="\${STUB_STATE:-/dev/null}"
case "$1 $2" in
  "project item-list") cat <<'J'
${JSON.stringify({ items: fx.items, totalCount: (fx.items as unknown[]).length })}
J
  ;;
  "issue list")
    for a in "$@"; do
      if [ "$a" = "closed" ]; then
        n=0; [ -f "$STUB_STATE" ] && n=$(cat "$STUB_STATE")
        echo $((n + 1)) > "$STUB_STATE"
        if [ "$n" -ge 1 ] && [ -n "\${SECOND_CLOSED:-}" ]; then
          echo "$SECOND_CLOSED"
        else
          echo '${JSON.stringify(fx.closed)}'
        fi
        exit 0
      fi
    done
    echo '${JSON.stringify(fx.open)}'
  ;;
  *) exit 1 ;;
esac
`,
  );
  await Deno.chmod(`${bin}/gh`, 0o755);

  const out = await new Deno.Command("bash", {
    args: [`${scripts}/sweep-closed.sh`, ...args],
    env: {
      PATH: `${bin}:${Deno.env.get("PATH")}`,
      STUB_STATE: `${dir}/calls`,
      ...(fx.closedOnSecondCall ? { SECOND_CLOSED: JSON.stringify(fx.closedOnSecondCall) } : {}),
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

const item = (number: number, status: string) => ({
  content: { type: "Issue", number, repository: "https://github.com/acme/widget" },
  status,
});

Deno.test("a closed issue outside Done is reported as drifted", async () => {
  const r = await runSweep({
    items: [item(513, "Ready"), item(9, "In progress")],
    closed: [513],
    open: [9],
  });
  assertEquals(r.code, 0);
  assertStringIncludes(r.stdout, "DRIFTED  513 Ready");
  assertStringIncludes(r.stdout, "scanned 2, drifted 1, reopened 0");
  assert(!r.stdout.includes("DRIFTED  9"), "an open issue must not drift");
});

Deno.test("a reopened issue still in Done is reported, never moved", async () => {
  const r = await runSweep({ items: [item(42, "Done")], closed: [], open: [42] });
  assertEquals(r.code, 0);
  assertStringIncludes(r.stdout, "REOPENED 42");
  assertStringIncludes(r.stdout, "drifted 0, reopened 1");
  // The script's contract is to report; nothing in its output instructs a move.
  assert(!r.stdout.includes("DRIFTED"), "a reopened issue is not a drift to correct");
});

Deno.test("a clean board is a quiet success, not silence", async () => {
  const r = await runSweep({ items: [item(1, "Done"), item(2, "Ready")], closed: [1], open: [2] });
  assertEquals(r.code, 0);
  assertStringIncludes(r.stdout, "scanned 2, drifted 0, reopened 0");
});

Deno.test("scanning nothing is a failure, not a clean board", async () => {
  // The defect this guards is the one that ran for three months in the
  // marketplace sync: a query that matches nothing produces the same output as
  // a run with nothing to do, and exits 0.
  const r = await runSweep({ items: [], closed: [], open: [] });
  assertEquals(r.code, 1);
  assertStringIncludes(r.stderr, "scanned 0");
  assertStringIncludes(r.stderr, "not the same as a clean board");
});

Deno.test("items from another repository on the shared board are ignored", async () => {
  // The board is org-wide. A sweep that reported another repo's cards would
  // attribute drift to work this repository never did.
  const foreign = {
    content: { type: "Issue", number: 77, repository: "https://github.com/acme/other" },
    status: "Ready",
  };
  const r = await runSweep({ items: [item(5, "Ready"), foreign], closed: [5, 77], open: [] });
  assertEquals(r.code, 0);
  assertStringIncludes(r.stdout, "DRIFTED  5 Ready");
  assert(!r.stdout.includes("77"), "another repository's card must not be reported");
  assertStringIncludes(r.stdout, "scanned 1,");
});

Deno.test("--since rejects anything that is not a whole number of hours", async () => {
  for (const bad of ["-3", "abc", "1.5"]) {
    const r = await runSweep({ items: [item(1, "Ready")], closed: [1], open: [] }, [
      "--since",
      bad,
    ]);
    assertEquals(r.code, 2, `--since ${bad} should be a usage error`);
  }
});

Deno.test("a second pass catches an issue GitHub had not closed yet", async () => {
  // The real race: the push returns, the merge phase sweeps, and GitHub's
  // auto-close lands a second or two later. One pass sees a clean board and
  // says so with total confidence — which is the failure this option exists
  // for, not a hypothetical one.
  const r = await runSweep(
    { items: [item(7, "Ready")], closed: [], open: [7], closedOnSecondCall: [7] },
    ["--passes", "2"],
  );
  assertEquals(r.code, 0);
  assertStringIncludes(r.stdout, "DRIFTED  7 Ready");
  assertStringIncludes(r.stdout, "drifted 1");
});

Deno.test("one pass reports the same race as a clean board", async () => {
  // Pins why --passes exists: without it the output above is indistinguishable
  // from nothing being wrong.
  const r = await runSweep(
    { items: [item(7, "Ready")], closed: [], open: [7], closedOnSecondCall: [7] },
  );
  assertEquals(r.code, 0);
  assertStringIncludes(r.stdout, "drifted 0");
});

Deno.test("--passes rejects zero and non-numbers", async () => {
  for (const bad of ["0", "two", "-1"]) {
    const r = await runSweep({ items: [item(1, "Ready")], closed: [1], open: [] }, [
      "--passes",
      bad,
    ]);
    assertEquals(r.code, 2, `--passes ${bad} should be a usage error`);
  }
});
