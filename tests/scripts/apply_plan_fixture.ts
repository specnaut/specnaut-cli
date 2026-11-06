import { assert } from "@std/assert";
import { join } from "@std/path";
import { type Backend, type Project, type Result } from "./backlog_tracker_fixture.ts";
import { gitProject, readItems, removeRead } from "./read_items_fixture.ts";

/**
 * `apply-plan.sh`, the bundled executor, run through its real entry point:
 * `read-items.sh` writes the items file, a plan is written outside the
 * repository, and `apply-plan.sh` applies it with every tracker CLI replaced
 * by a stand-in that logs its argv. A test reads what reached the stand-in.
 */

/** Every call that writes to GitHub, as the stand-in logs it. */
export const GH_WRITES =
  /^gh\t(issue\t(create|comment|edit|close)|project\titem-(edit|add)|api\t-X\t(POST|PATCH))/m;

/**
 * A stand-in `gh` that answers from `fake/`: issue-<n>.json for the GraphQL
 * record, children-<n>.json for sub-issues, closed-<n> to mark one closed,
 * patch-fails for an organization with no issue types. It applies `--jq`
 * itself, logs argv, and logs a `--body-file`'s content on a BODY line.
 */
const GH = `#!/usr/bin/env bash
printf gh >> "$FAKE_ROOT/calls.log"
for a in "$@"; do printf '\\t%s' "\${a//$'\\n'/ }" >> "$FAKE_ROOT/calls.log"; done
echo >> "$FAKE_ROOT/calls.log"
prev="" jqx=""
for a in "$@"; do
  [ "$prev" != --body-file ] || printf 'BODY\\t%s\\n' "$(tr '\\n' ' ' < "$a")" >> "$FAKE_ROOT/calls.log"
  [ "$prev" != --jq ] || jqx=$a
  prev=$a
done
out() { if [ -n "$jqx" ]; then jq -r "$jqx"; else cat; fi; }
F="$FAKE_ROOT/fake"
case "$1 $2" in
  "auth status") exit 1 ;;
  "project view") echo '{"id":"PVT"}' | out ;;
  "project field-list") out < "$F/fields.json" ;;
  "project item-add") echo '{"id":"ITEM"}' | out ;;
  "label list") out < "$F/labels.json" ;;
  "issue create") echo "https://github.com/acme/my-app/issues/5" ;;
  "issue view") echo '{"body":"Old body"}' | out ;;
  "api graphql")
    case "$*" in *"projectItems(first:5)"*)
      echo '{"data":{"repository":{"issue":{"projectItems":{"nodes":[{"id":"ITEM","project":{"id":"PVT"}}]}}}}}' | out
      exit 0 ;;
    esac
    n=""; for a in "$@"; do case "$a" in num=*) n=\${a#num=} ;; esac; done
    [ -n "$n" ] && [ -f "$F/issue-$n.json" ] || exit 1
    out < "$F/issue-$n.json" ;;
  "api -X")
    if [ "$3" = PATCH ] && [ -f "$F/patch-fails" ]; then echo "HTTP 422: Validation Failed"; exit 1; fi
    echo '{"type":{"name":"Feature"}}' | out ;;
  "api --paginate")
    n=$(printf '%s' "$3" | sed 's|.*/issues/\\([0-9]*\\)/sub_issues$|\\1|')
    if [ -f "$F/children-$n.json" ]; then out < "$F/children-$n.json"; else echo '[]' | out; fi ;;
  "api repos/"*)
    n=\${2##*/}
    s=open; [ ! -f "$F/closed-$n" ] || s=closed
    printf '{"state":"%s","id":%s,"number":%s}\\n' "$s" "$((n + 1000))" "$n" | out ;;
esac
exit 0
`;

const FIELDS = {
  fields: [
    {
      id: "F1",
      name: "Status",
      type: "ProjectV2SingleSelectField",
      options: ["Backlog", "Ready", "In progress", "Done"].map((n, i) => ({
        id: `s${i}`,
        name: n,
      })),
    },
    {
      id: "F2",
      name: "Priority",
      type: "ProjectV2SingleSelectField",
      options: ["P0", "P1", "P2", "P3"].map((n) => ({ id: `p${n}`, name: n })),
    },
  ],
};

/** One GraphQL issue record, as item-record.sh reads it. */
export function ghIssue(title: string, author = "another-author", body = "Plain.") {
  return {
    data: {
      repository: {
        issue: {
          title,
          body,
          createdAt: "2026-03-04T05:06:07Z",
          state: "OPEN",
          stateReason: null,
          author: { login: author },
          authorAssociation: "NONE",
          viewerDidAuthor: false,
          labels: { nodes: [] },
          comments: { nodes: [] },
          projectItems: { nodes: [] },
        },
      },
    },
  };
}

/** A GitHub project whose stand-in knows these issues; written before any read. */
export async function ghProject(
  issues: Record<number, unknown>,
  extra: Record<string, string> = {},
): Promise<Project> {
  const p = await gitProject("github");
  await Deno.mkdir(join(p.dir, "fake"));
  await p.write("bin/gh", GH);
  await p.write("fake/fields.json", JSON.stringify(FIELDS));
  await p.write(
    "fake/labels.json",
    JSON.stringify(["bug", "tech-debt", "type:feature"].map((name) => ({ name }))),
  );
  for (const [n, v] of Object.entries(issues)) {
    await p.write(`fake/issue-${n}.json`, JSON.stringify(v));
  }
  for (const [f, v] of Object.entries(extra)) await p.write(`fake/${f}`, v);
  return p;
}

export interface Applied extends Result {
  lines: string[];
}

/** read-items.sh <readArgs>, then apply-plan.sh <verb> [--id] <plan> <items>; `between` runs in the gap. */
export async function readThenApply(
  p: Project,
  readArgs: string[],
  plan: string,
  o: { apply?: string[]; between?: () => Promise<void> } = {},
): Promise<Applied> {
  const { r, read } = await readItems(p, readArgs);
  assert(read, `read-items failed: ${r.stderr}`);
  const dir = await Deno.makeTempDir({ prefix: "plan-" });
  try {
    await Deno.writeTextFile(join(dir, "plan.jsonl"), plan);
    await o.between?.();
    const at = readArgs.indexOf("--id");
    const verbAndId = o.apply ?? [readArgs[0], ...(at >= 0 ? ["--id", readArgs[at + 1]] : [])];
    const out = await p.run("apply-plan.sh", [...verbAndId, join(dir, "plan.jsonl"), read.path]);
    return { ...out, lines: out.stdout.trimEnd().split("\n") };
  } finally {
    await Deno.remove(dir, { recursive: true });
    await removeRead(read);
  }
}

/** JSON Lines from objects. */
export const jsonl = (...ops: unknown[]) => ops.map((o) => JSON.stringify(o)).join("\n") + "\n";

export type { Backend };
