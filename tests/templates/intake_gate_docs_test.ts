import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/**
 * cli#760 — whether a run may proceed past the intake gate is decided once, in
 * auto-chain.md; every caller points there and restates none of it, and the
 * closeout keeps one order and one hold (FR-5, FR-7, FR-11, FR-13).
 */

const T = fromFileUrl(new URL("../../templates/core/skills/task/", import.meta.url));
const read = (p: string) => Deno.readTextFileSync(join(T, p)).replace(/\r\n/g, "\n");
const flat = (s: string) => s.replace(/\s+/g, " ");
const SENTENCE = "**Proceed only on exit 0 whose last line is `gate clear`; any other exit or " +
  "last line stops, quoting the gate's lines.**";
const CALLERS = ["phases/plan.md", "phases/implement.md", "phases/merge.md", "resume.md"];
const count = (s: string, needle: string) => s.split(needle).length - 1;

Deno.test("auto-chain.md is the one home of the proceed rule, the call and the fence question", () => {
  const chain = flat(read("phases/auto-chain.md"));
  assertEquals(count(chain, SENTENCE), 1);
  assertStringIncludes(chain, "bash .specnaut/scripts/bash/wip-audit.sh --gate --own <id>");
  for (
    const row of [
      "| `PENDING closeout <n> …` | `/task resume <n>` |",
      "| `PARTIAL closeout <n> …` | `/task plan <n>`",
      "| `PENDING push <sha>` |",
      "| `FENCED closeout <n> …` | the question below",
      "| `INVALID closeout …` | by hand: remove `.specnaut/feature.json` in its own commit",
    ]
  ) assertStringIncludes(chain, row);
  assertStringIncludes(chain, "Yes runs against the board it now names.");
  assertStringIncludes(chain, "Anything else runs no backlog script and stops.");
  assertStringIncludes(chain, "`--fence-ack <n>` added, for that run only");
});

Deno.test("each caller names the intake gate once and restates none of its rule", () => {
  for (const p of CALLERS) {
    const src = flat(read(p));
    assertEquals(
      count(src, "intake gate"),
      1,
      `${p} names the gate ${count(src, "intake gate")} times`,
    );
    for (
      const rule of ["gate clear", "gate blocked", "--fence-ack", "exit 4", "--own", "--since"]
    ) {
      assert(!src.includes(rule), `${p} restates the gate's rule: ${rule}`);
    }
  }
  // Only resume reads the gate's lines, and it reads them as row evidence.
  for (const p of ["phases/plan.md", "phases/implement.md"]) {
    assert(
      !/(PENDING|PARTIAL|FENCED|INVALID) (push|closeout)/.test(read(p)),
      `${p} reads a gate line`,
    );
  }
});

Deno.test("the UNPUSHED restatements are pointers now", () => {
  const plan = flat(read("phases/plan.md"));
  assert(!plan.includes("where its row stops (`UNPUSHED`)"), "plan.md restates the stop");
  assert(!plan.includes("`UNPUSHED` is a stop as above"), "plan.md restates the cloud stop");
  assert(!read("phases/implement.md").includes("that push is `merge`'s recovery"));
  assert(!flat(read("phases/auto-chain.md")).includes("`UNPUSHED` lists `origin/<base>..<base>`"));
  assert(!read("resume.md").includes("`UNPUSHED`, or `origin/<base>..<base>` is not empty"));
});

Deno.test("merge runs the gate at its three points and marks a partial delivery on the branch", () => {
  const merge = flat(read("phases/merge.md"));
  assertStringIncludes(
    merge,
    "runs before step 2, before every run of step 3, and, under `--no-close`, once more after the push",
  );
  const mark = merge.indexOf('set `"delivery": "partial"` in `.specnaut/feature.json`');
  assert(
    mark > 0 && mark < merge.indexOf("load `phases/merge-squash.md`"),
    "partial is not written before the squash",
  );
  assertStringIncludes(
    merge,
    "**Under `--no-close`, first mark the delivery partial, on the branch:**",
  );
  assertStringIncludes(
    merge,
    "so it lands with the work, in the same fast-forward or the same push",
  );
  assertStringIncludes(
    merge,
    "as `git commit --fixup <the last CHILD's sha>`, which the fold folds",
  );
  assertStringIncludes(merge, "After the PR lands, `/task resume <n>` settles it.");
  assert(!merge.includes("close keyword"), "the forge-keyword sentence is back");
});

Deno.test("merge-close: one closeout order, a hold only on 20, and a re-entry fed by the gate's line", () => {
  const close = flat(read("phases/merge-close.md"));
  const step = (n: number) =>
    close.slice(close.indexOf(` ${n}. **`), close.indexOf(` ${n + 1}. **`));
  const two = step(2);
  assertStringIncludes(two, "one order, on every backend, on the first run and on re-entry");
  assert(!two.includes("skip to step 3"), "local and cloud skip the check again");
  const four = close.slice(close.indexOf(" 4. **"), close.indexOf("## Re-entry"));
  assertStringIncludes(four, "only after step 3 exited 0 or 21.**");
  // Local and cloud: step 3 runs per item inside step 2, once (its per-item run is pinned below).
  assertStringIncludes(two, "and not again after the loop");
  assertStringIncludes(
    two,
    "step 4 runs only when every one of these per-item runs exited 0 or 21",
  );
  assertStringIncludes(four, "On **20** the tracker did not confirm the close: remove nothing.");
  const reentry = close.slice(close.indexOf("## Re-entry"), close.indexOf("## The report"));
  assertStringIncludes(reentry, "Landed scripts are the project's own");
  assertStringIncludes(reentry, "**Steps 2 to 4, as written above.**");
  assertStringIncludes(
    close,
    "on re-entry, the `<sha>` of the gate's line, matching `^[0-9a-f]{40}$`",
  );
});

Deno.test("resume reads the gate's lines in the plan's row order, and names its one exception", () => {
  const rows = read("resume.md").split("\n").filter((l) =>
    l.startsWith("| ") && !l.includes(":---")
  )
    .slice(1).map((l) => l.split(" | ")[0].slice(2));
  const at = (prefix: string) => rows.findIndex((r) => r.startsWith(prefix));
  const order = [
    "the id is malformed",
    "a `PENDING push` line",
    "`OWN closeout <id>",
    "`FENCED closeout <id>",
    "`OWN partial <id>",
    "`INVALID closeout",
    "a gate line other than its last, the verdict",
    "the item is closed",
  ].map(at);
  assert(!order.includes(-1), `a row is missing: ${JSON.stringify(order)}`);
  assertEquals([...order].sort((a, b) => a - b), order, "the rows are out of order");
  const resume = flat(read("resume.md"));
  // FR-10: only a lone removal commit is pushed; anything else on the local base is someone's.
  const push = rows.find((r) => r.startsWith("a `PENDING push` line"));
  assertStringIncludes(
    resume,
    "| a `PENDING push` line | exactly one, whose diff only deletes the " +
      "`<dir>` and `.specnaut/feature.json` of the base's marker: `phases/merge-close.md` step 4's exit-7 row.",
  );
  assertStringIncludes(
    resume,
    "Otherwise nothing: name each sha and whether it names the item, and " +
      "stop; they are someone's work |",
  );
  assert(push, "no push row");
  assertStringIncludes(resume, "Its one exception is a closeout an earlier landing left");
  assertStringIncludes(resume, "except through `phases/merge-close.md` § Re-entry.");
});

Deno.test("epic-commits.md points at every table that maps epic-status.sh's exits", () => {
  const doc = flat(read("phases/epic-commits.md"));
  assertStringIncludes(doc, "`phases/merge.md` step 1 for the branch");
  assertStringIncludes(doc, "`phases/merge-close.md` § Re-entry for `--landed`");
  assertStringIncludes(doc, "the header of `.specnaut/scripts/bash/_intake_gate.sh`");
});

/**
 * tests/scripts/closeout_fixture.ts plays the agent through these docs in TypeScript, so it cannot
 * notice a doc that changed under it: each branch it takes is pinned to the sentence defining it.
 */
const [MC, AC, RS] = ["phases/merge-close.md", "phases/auto-chain.md", "resume.md"];
const FIXTURE_BRANCHES: [string, string, string][] = [
  ["shipped: --landed", MC, "epic-status.sh --landed <n>@<epoch>`"],
  ["shipped: both lists", MC, "both that call and `cascade-check.sh --numbers <n>` list"],
  ["closeEach: children, then the epic", MC, "Children first, the epic last."],
  ["closeEach: the check first", MC, "cascade-check.sh <n>` before its close"],
  ["closeEach: 12", MC, "**12** — already closed: skip its close"],
  ["closeEach: 11", MC, "**11** — a child is still open: name it and stop before step 3"],
  ["closeEach: 3", MC, "**3** — the check could not answer: say so and stop before step 3"],
  ["closeEach: per item", MC, "step 3 runs here, for that one item, before the next item's check"],
  ["closeEach: 20", MC, "**20** from it stops before the next item's check"],
  ["reenter: partial", MC, "runs 1 and 2, then step 4 alone: nothing closes."],
  [
    "removeSpec: none",
    MC,
    "goes alone: `bash .specnaut/scripts/bash/remove-spec.sh --marker-only <n>`",
  ],
  ["removeSpec: a directory", MC, "the last segment of the gate's `<dir>`"],
  ["removeSpec: 7", MC, "**7** — the push was rejected"],
  ["reenter: the line alone", MC, "nowhere else: never open `.specnaut/feature.json`"],
  ["pushRow: the recovery", MC, "`git pull --rebase --no-autostash origin <base>`, then `git push"],
  ["row: clear", AC, "Proceed only on exit 0 whose last line is `gate clear`"],
  ["row: FENCED, a yes", AC, "A yes reruns the gate with `--fence-ack <n>`"],
  ["row: FENCED, a no", AC, "Anything else runs no backlog script and stops."],
  ["row: push", RS, "| a `PENDING push` line | exactly one, whose diff only deletes"],
  ["row: FENCED", RS, "| `FENCED closeout <id> …` | the question `phases/auto-chain.md` asks"],
  ["row: OWN closeout", RS, "| `OWN closeout <id> <dir> <sha>` (or `PENDING closeout <id> …`)"],
  ["row: OWN partial", RS, "| `OWN partial <id> …` (or `PARTIAL closeout <id> …`)"],
];

Deno.test("every branch the closeout fixture takes is pinned to the sentence that defines it", () => {
  const missing = FIXTURE_BRANCHES.filter(([, doc, s]) => !flat(read(doc)).includes(s));
  assertEquals(missing.map(([branch]) => branch), []);
});
