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
  assertStringIncludes(two, "**12** — already closed: skip its close");
  assertStringIncludes(two, "**11** — a child is still open: name it and stop before step 3");
  assertStringIncludes(two, "**3** — the check could not answer: say so and stop before step 3");
  assert(!two.includes("skip to step 3"), "local and cloud skip the check again");
  const four = close.slice(close.indexOf(" 4. **"), close.indexOf("## Re-entry"));
  assertStringIncludes(four, "only after step 3 exited 0 or 21.**");
  // Local and cloud: step 3 runs per item inside step 2, once, and a 20 stops the loop.
  for (
    const s of [
      "step 3 runs here, for that one item, before the next item's check",
      "and not again after the loop",
      "**20** from it stops before the next item's check",
      "step 4 runs only when every one of these per-item runs exited 0 or 21",
    ]
  ) assertStringIncludes(two, s);
  assertStringIncludes(four, "On **20** the tracker did not confirm the close: remove nothing.");
  assertStringIncludes(four, "remove-spec.sh --marker-only <n>");
  const reentry = close.slice(close.indexOf("## Re-entry"), close.indexOf("## The report"));
  assertStringIncludes(
    reentry,
    "come from the gate's line and nowhere else: never open `.specnaut/feature.json`",
  );
  assertStringIncludes(reentry, "epic-status.sh --landed <n>@<epoch>");
  assertStringIncludes(reentry, "`cascade-check.sh --numbers <n>`");
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

Deno.test("epic-commits.md names both places that map epic-status.sh's exits", () => {
  const doc = flat(read("phases/epic-commits.md"));
  assertStringIncludes(doc, "`phases/merge.md` step 1 for the branch");
  assertStringIncludes(doc, "`phases/merge-close.md` § Re-entry for `--landed`");
});
