import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

/**
 * Behavioural tests for `github/move-batch.sh` — the script that actually
 * writes to the board.
 *
 * It shipped with none. Criteria 7, 9 and 10 of monorepo#18 were verified by
 * reading it, which is the weaker evidence this whole ticket exists to reject:
 * the batching claim ("N cards cost 2 requests, not 2N") is a property of the
 * request shape, and reading the source proves only what it was meant to do.
 *
 * The stub therefore counts calls as well as answering them.
 */

const SCRIPT_DIR = fromFileUrl(
  new URL("../../templates/core/skills/task/scripts/github", import.meta.url),
);

/** `present` are issue numbers the project knows; anything else resolves null. */
async function runBatch(args: string[], present: number[]) {
  const dir = await Deno.makeTempDir();
  const scripts = `${dir}/.specnaut/scripts/backlog`;
  await Deno.mkdir(scripts, { recursive: true });
  await Deno.writeTextFile(
    `${dir}/.specnaut/backlog-config.yml`,
    "repo: acme/widget\nproject_number: 1\n",
  );
  for (const f of ["_config.sh", "move-batch.sh"]) {
    await Deno.copyFile(`${SCRIPT_DIR}/${f}`, `${scripts}/${f}`);
  }

  const bin = `${dir}/bin`;
  await Deno.mkdir(bin);
  // Every `gh api graphql` invocation appends its query to a log, so the test
  // can assert on how many round-trips happened, not merely on the output.
  await Deno.writeTextFile(
    `${bin}/gh`,
    `#!/usr/bin/env bash
LOG="\${GH_LOG}"
case "$1 $2" in
  "project view") echo '{"id":"PVT_x"}' ;;
  "project field-list")
    echo '{"fields":[{"name":"Status","id":"F_x","options":[{"name":"Done","id":"OPT_done"}]}]}' ;;
  "api graphql")
    q=""
    for a in "$@"; do case "$a" in query=*) q="\${a#query=}" ;; esac; done
    case "$q" in
      mutation*) echo "MUTATION" >> "$LOG"; echo '{"data":{}}' ;;
      *)
        echo "QUERY" >> "$LOG"
        present='${JSON.stringify(present)}'
        echo "$q" | grep -oE 'i[0-9]+: issue\\(number:[0-9]+\\)' \\
          | sed -E 's/(i[0-9]+): issue\\(number:([0-9]+)\\)/\\1 \\2/' \\
          | jq -R -s -c --argjson p "$present" '
              [ split("\\n")[] | select(length > 0) | split(" ")
                | . as [$alias, $raw] | ($raw | tonumber) as $n
                | { key: $alias,
                    value: (if (($p | index($n)) != null)
                            then { number: $n,
                                   projectItems: { nodes: [ { id: ("ITEM_" + $raw),
                                                              project: { id: "PVT_x" } } ] } }
                            else { number: $n,
                                   projectItems: { nodes: [] } } end) } ]
              | from_entries | { data: { repository: . } }'
        ;;
    esac
    ;;
  *) exit 1 ;;
esac
`,
  );
  await Deno.chmod(`${bin}/gh`, 0o755);

  const log = `${dir}/gh.log`;
  await Deno.writeTextFile(log, "");
  const out = await new Deno.Command("bash", {
    args: [`${scripts}/move-batch.sh`, ...args],
    env: { PATH: `${bin}:${Deno.env.get("PATH")}`, GH_LOG: log },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const calls = (await Deno.readTextFile(log)).trim().split("\n").filter(Boolean);
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
    graphql: calls,
  };
}

Deno.test("five cards cost one query and one mutation, not ten", async () => {
  // The whole claim of this script. A per-item loop would log 5 of each.
  const r = await runBatch(["Done", "1", "2", "3", "4", "5"], [1, 2, 3, 4, 5]);
  assertEquals(r.code, 0, r.stderr);
  assertEquals(r.graphql.filter((c) => c === "QUERY").length, 1);
  assertEquals(r.graphql.filter((c) => c === "MUTATION").length, 1);
  assertStringIncludes(r.stdout, "moved 5 of 5 in 2 requests");
});

Deno.test("a card absent from the project is skipped, the rest still move", async () => {
  // One bad card must never abort the sweep — the merge has already happened.
  const r = await runBatch(["Done", "1", "99", "3"], [1, 3]);
  console.error("CODE", r.code, "OUT", JSON.stringify(r.stdout), "ERR", JSON.stringify(r.stderr));
  assertEquals(r.code, 0, r.stderr);
  assertStringIncludes(r.stderr, "#99 is not on Project");
  assertStringIncludes(r.stdout, "✓ #1 → Done");
  assertStringIncludes(r.stdout, "✓ #3 → Done");
  assertStringIncludes(r.stdout, "moved 2 of 3");
  assert(!r.stdout.includes("#99 → Done"));
});

Deno.test("nothing resolvable is a failure, not a quiet success", async () => {
  const r = await runBatch(["Done", "7", "8"], []);
  assertEquals(r.code, 1);
  assertStringIncludes(r.stderr, "moved 0 of 2");
  assertEquals(r.graphql.filter((c) => c === "MUTATION").length, 0, "must not write");
});

Deno.test("an unknown status is refused before any write", async () => {
  const r = await runBatch(["Shipped", "1"], [1]);
  assertEquals(r.code, 1);
  assertStringIncludes(r.stderr, "unknown status 'Shipped'");
  assertEquals(r.graphql.length, 0, "must not touch the board");
});

Deno.test("too few arguments is a usage error", async () => {
  for (const args of [[], ["Done"]]) {
    const r = await runBatch(args, [1]);
    assertEquals(r.code, 2, `${JSON.stringify(args)} should be a usage error`);
  }
});
