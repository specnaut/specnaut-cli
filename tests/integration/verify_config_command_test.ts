import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { CONFIG_INPUTS } from "../../src/domain/config_trust.ts";
import {
  bundled,
  commitAll,
  fixture,
  GIT_READ,
  LOCK,
  verify,
  write,
} from "./verify_scripts_fixture.ts";

/**
 * `specnaut verify-scripts`' config verdicts, black-box: one `VERDICT <class>` line per input a
 * branch controls, the tree's value judged against the base's tip, before the scripts' last line.
 * For each class, the base holds the input and the branch edits it: that class alone is untrusted.
 */

const CONFIG: Record<string, string> = {
  ".specnaut/workflow.yml": "merge: manual\n",
  ".specnaut/size-limits.yml": "file:\n  target: 200\n",
  ".specnaut/boundaries.yml": "domain:\n  - src/domain\n",
  ".specnaut/backlog-config.yml": 'repo: "acme/my-app"\nproject_number: 1\n',
  ".specnaut/feature.json": '{ "feature_directory": "specs/001-x", "linked_issue": 42 }\n',
  ".specnaut/gates.yml": "fast_gate:\n  - deno task test\n",
};
const EDITED: Record<string, string> = {
  ".specnaut/workflow.yml": "merge: auto\n",
  ".specnaut/size-limits.yml": "file:\n  target: none\n",
  ".specnaut/boundaries.yml": "domain:\n  - src/none\n",
  ".specnaut/backlog-config.yml": 'repo: "acme/other"\nproject_number: 1\n',
  ".specnaut/feature.json": '{ "feature_directory": "specs/001-x", "linked_issue": 7 }\n',
  ".specnaut/gates.yml": "fast_gate:\n  - true\n",
};

const base = () => ({ ".specnaut/installed.lock": LOCK, [GIT_READ]: bundled(GIT_READ), ...CONFIG });
const verdicts = (lines: string[]) =>
  lines.filter((l) => l.startsWith("VERDICT ") && !l.startsWith("VERDICT scripts "));

Deno.test("a branch that leaves its config alone gets one trusted line per class, in order", async () => {
  const { root } = await fixture({ files: base() });
  const v = await verify(root);
  assertEquals(verdicts(v.lines), CONFIG_INPUTS.map((i) => `VERDICT ${i.class} trusted`));
  assertEquals([v.code, v.lines.at(-1)], [0, "VERDICT scripts trusted"], v.stderr);
});

for (const input of CONFIG_INPUTS) {
  Deno.test(`a branch that edits ${input.path} makes ${input.class} untrusted, and no other`, async () => {
    const { root } = await fixture({ files: base() });
    await write(root, { [input.path]: EDITED[input.path] });
    await commitAll(root, `edit ${input.path}`);
    const v = await verify(root);
    const want = CONFIG_INPUTS.map((i) =>
      i === input
        ? `VERDICT ${i.class} untrusted ${i.path} differs from base`
        : `VERDICT ${i.class} trusted`
    );
    assertEquals(verdicts(v.lines), want);
    // The scripts are untouched: the exit and the last line are theirs alone.
    assertEquals([v.code, v.lines.at(-1)], [0, "VERDICT scripts trusted"], v.stderr);
  });
}

Deno.test("an uncommitted edit counts: the work tree is what the phases would read", async () => {
  const { root } = await fixture({ files: base() });
  await write(root, { ".specnaut/gates.yml": EDITED[".specnaut/gates.yml"] });
  const v = await verify(root);
  assertEquals(
    verdicts(v.lines).find((l) => l.startsWith("VERDICT gates ")),
    "VERDICT gates untrusted .specnaut/gates.yml differs from base",
  );
});

Deno.test({
  name: "a config input that is a link is untrusted, never followed",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const { root } = await fixture({ files: base() });
    await Deno.remove(join(root, ".specnaut/workflow.yml"));
    await Deno.writeTextFile(join(root, "elsewhere.yml"), CONFIG[".specnaut/workflow.yml"]);
    await Deno.symlink("../elsewhere.yml", join(root, ".specnaut/workflow.yml"));
    const line = verdicts((await verify(root)).lines)[0];
    assertEquals(line, "VERDICT workflow untrusted .specnaut/workflow.yml a link");
  },
});
