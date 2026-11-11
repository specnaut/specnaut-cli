import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { git, sandbox } from "./git_sandbox.ts";
import { DIR, gate, land, lines, marker } from "./wip_audit_gate_fixture.ts";

/**
 * cli#760 — `wip-audit.sh --gate`, the one home of "an earlier landing is
 * unsettled" (_intake_gate.sh): the lines it prints for a push, a pending
 * closeout and an INVALID marker.
 */

Deno.test("nothing unsettled: the one line is gate clear, exit 0", async () => {
  const sb = await sandbox();
  try {
    const r = await gate(sb);
    assertEquals([r.code, r.stdout], [0, "gate clear\n"], r.stderr);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("every commit origin lacks is PENDING push, oldest first, and --own never clears one", async () => {
  const sb = await sandbox();
  try {
    const a = await sb.commit("a", "a\n", "feat(11): one");
    const b = await sb.commit("b", "b\n", "chore: two");
    const r = await gate(sb, "--own", "11");
    assertEquals(r.code, 4, r.stderr);
    assertEquals(lines(r.stdout), [`PENDING push ${a}`, `PENDING push ${b}`, "gate blocked"]);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a published marker is PENDING closeout with its directory and naming sha; --own makes it OWN", async () => {
  const sb = await sandbox();
  try {
    const sha = await land(sb, marker(21), "feat(21): the feature");
    await sb.commit("later", "x\n", "chore: unrelated, later");
    await git(sb.work, "push", "--quiet", "origin", "main");
    const r = await gate(sb);
    assertEquals(r.code, 4, r.stderr);
    assertEquals(lines(r.stdout), [`PENDING closeout 21 ${DIR} ${sha}`, "gate blocked"]);
    const own = await gate(sb, "--own", "9", "--own", "21", "--since", "21@0");
    assertEquals(own.code, 0, own.stderr);
    assertEquals(lines(own.stdout), [`OWN closeout 21 ${DIR} ${sha}`, "gate clear"]);
    // Another item's --own is not this one's.
    assertEquals((await gate(sb, "--own", "2")).code, 4);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a marker only on the local base is the push, not a closeout; a null link never blocks", async () => {
  const sb = await sandbox();
  try {
    const c = await sb.commit(".specnaut/feature.json", marker(31), "feat(31): not pushed");
    const r = await gate(sb, "--own", "31");
    assertEquals(lines(r.stdout), [`PENDING push ${c}`, "gate blocked"]);
    await git(sb.work, "push", "--quiet", "origin", "main");
    await land(sb, marker("null"), "feat: no item");
    assertEquals(lines((await gate(sb)).stdout), ["gate clear"]);
    await sb.commit(".specnaut/feature.json", '{ "linked_issue": null }\n', "chore: cloud form");
    await git(sb.work, "push", "--quiet", "origin", "main");
    assertEquals(lines((await gate(sb)).stdout), ["gate clear"]);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a cloud marker, with no feature_directory, prints - for the directory", async () => {
  const sb = await sandbox();
  try {
    const sha = await sb.commit(
      ".specnaut/feature.json",
      '{ "linked_issue": 32 }\n',
      "feat(32): x",
    );
    await git(sb.work, "push", "--quiet", "origin", "main");
    assertEquals(lines((await gate(sb)).stdout)[0], `PENDING closeout 32 - ${sha}`);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("INVALID: a malformed link, a directory outside the rule, a link, a missing one, no landed commit", async () => {
  const cases: [string, string, string, string][] = [
    // [label, feature.json, subject, the line]
    [
      "a quoted number",
      `{ "feature_directory": "${DIR}", "linked_issue": "41" }\n`,
      "feat(41): x",
      "INVALID closeout -",
    ],
    ["no link at all", `{ "feature_directory": "${DIR}" }\n`, "feat(41): x", "INVALID closeout -"],
    [
      "a parent path",
      marker(41).replace(DIR, ".specnaut/specs/../x"),
      "feat(41): x",
      "INVALID closeout 41",
    ],
    [
      "a nested path",
      marker(41).replace(DIR, `${DIR}/deeper`),
      "feat(41): x",
      "INVALID closeout 41",
    ],
    [
      "outside specs",
      marker(41).replace(DIR, ".specnaut/001-x"),
      "feat(41): x",
      "INVALID closeout 41",
    ],
    [
      "a null directory",
      '{ "feature_directory": null, "linked_issue": 41 }\n',
      "feat(41): x",
      "INVALID closeout 41",
    ],
    ["no commit names it", marker(41), "feat: unnamed", "INVALID closeout 41"],
  ];
  for (const [label, json, subject, line] of cases) {
    const sb = await sandbox();
    try {
      await land(sb, json, subject);
      const r = await gate(sb, "--own", "41", "--fence-ack", "41");
      assertEquals([r.code, lines(r.stdout)], [4, [line, "gate blocked"]], `${label}: ${r.stderr}`);
    } finally {
      await sb.cleanup();
    }
  }
});

Deno.test("INVALID: a directory that is a link, or not in the tree", async () => {
  if (Deno.build.os === "windows") return; // a committed symlink needs core.symlinks
  const sb = await sandbox();
  try {
    await Deno.mkdir(join(sb.work, ".specnaut/specs"), { recursive: true });
    await Deno.symlink("../../elsewhere", join(sb.work, DIR));
    await git(sb.work, "add", DIR);
    await sb.commit(".specnaut/feature.json", marker(42), "feat(42): linked dir");
    await git(sb.work, "push", "--quiet", "origin", "main");
    assertEquals(lines((await gate(sb)).stdout)[0], "INVALID closeout 42");
    await git(sb.work, "rm", "--quiet", DIR);
    await git(sb.work, "commit", "--quiet", "-m", "chore: drop the link");
    await git(sb.work, "push", "--quiet", "origin", "main");
    assertEquals(lines((await gate(sb)).stdout)[0], "INVALID closeout 42");
    await Deno.remove(join(sb.work, ".specnaut/feature.json"));
    // A link's blob is its target text: one shaped like a marker must still read INVALID.
    await Deno.symlink('{ "linked_issue": 42 }', join(sb.work, ".specnaut/feature.json"));
    await git(sb.work, "add", ".specnaut/feature.json");
    await git(sb.work, "commit", "--quiet", "-m", "feat(42): a linked marker");
    await git(sb.work, "push", "--quiet", "origin", "main");
    assertEquals(lines((await gate(sb)).stdout)[0], "INVALID closeout -");
  } finally {
    await sb.cleanup();
  }
});
