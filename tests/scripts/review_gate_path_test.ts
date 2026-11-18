import { assertEquals } from "@std/assert";
import { DELIMITER, join } from "@std/path";
import { docBlock } from "./resolve_verifier_fixture.ts";
import { inLayout } from "./resolve_verifier_layout.ts";
import { each, gate } from "./review_gate_fixture.ts";

/**
 * A line that starts a review while it names PATH runs on a PATH review-gate.sh never sees: the hook
 * refuses it, an entry dropped or not, and lets through a line that only reads PATH.
 */

/** Lines that start a review and name PATH bare, so it can be set, by any spelling or letter case. */
const NAMES_PATH = [
  "PATH=./bin:$PATH specnaut review start 1",
  'export PATH="$PWD/bin:$PATH"; specnaut review start 1',
  "env PATH=bin specnaut review start 1",
  "PATH+=:bin; specnaut review start 1",
  "path+=(bin); specnaut review start 1",
  "PATH[0]=bin:$PATH specnaut review start 1",
  "read PATH; specnaut review start 1",
  "PA\\\nTH=bin specnaut review start 1",
  "ls # note\\\nPATH=bin specnaut review start 1",
];

/** Lines that start a review and only read PATH, name another variable, or quote the word. */
const READS_PATH = [
  "MYPATH=x specnaut review start 1",
  'echo "$PATH"; specnaut review start 1',
  'echo "a \\" in PATH"; specnaut review start 1',
  "GOPATH=/go NODE_PATH=lib echo $PATH ${PATH%%:*}; specnaut review start 1",
];

Deno.test({
  name: "a line that starts a review and names PATH is refused, with no entry dropped",
  ignore: Deno.build.os === "windows",
  fn: () =>
    inLayout(async (l, { bash }) => {
      const r = { entries: [join(l.tmp, "outside", "real"), l.tools], cwd: l.repo, bash };
      const want = {
        refused: "is named on the line that starts a review, where it can be set",
        exit: 2,
      };
      assertEquals(await gate(l, r, NAMES_PATH), each(NAMES_PATH, want));
      // The gate judges these, review-untrusted.md's start among them: the stub records itself.
      const read = [...READS_PATH, `${docBlock()}\nout=$("$sn" review start "1" --expect "abc")`];
      const gated = { resolved: l.outside, path: r.entries.join(DELIMITER) };
      assertEquals(await gate(l, r, read), each(read, gated));
    }),
});
