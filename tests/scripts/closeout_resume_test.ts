import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { git } from "./git_sandbox.ts";
import {
  backlog,
  DIR,
  gate,
  land,
  lines,
  project,
  reenter,
  resume,
  status,
} from "./closeout_fixture.ts";

/**
 * cli#760 FR-8 to FR-11 — a closeout re-entered from the intake gate's line,
 * on the local backend, with the real scripts: the gate, cascade-check.sh,
 * close-shipped.sh and remove-spec.sh, run in merge-close.md's one order. The
 * test plays the agent: it reads only the gate's line and the exits, never
 * feature.json, and stops wherever the phase docs say it stops.
 */

Deno.test("a closeout interrupted after each step is finished by resume, and running it again does no harm", async () => {
  for (const budget of [0, 1, 2]) {
    const sb = await project({ "21": { status: "In progress" } });
    try {
      await land(sb, `{ "feature_directory": "${DIR}", "linked_issue": 21 }\n`, "feat(21): x");
      assertEquals(
        lines((await gate(sb)).stdout)[0].split(" ").slice(0, 3).join(" "),
        "PENDING closeout 21",
      );
      assertEquals(await resume(sb, "21", budget), ["gate clear"], `budget ${budget}`);
      assertEquals(await status(sb, "21"), "Done");
      assertEquals(
        await git(sb.remote, "ls-tree", "--name-only", "main", "--", ".specnaut/feature.json", DIR),
        "",
      );
      // Again: nothing to settle, nothing written.
      const head = await git(sb.work, "rev-parse", "HEAD");
      assertEquals(await resume(sb, "21"), ["gate clear"]);
      assertEquals(await git(sb.work, "rev-parse", "HEAD"), head);
    } finally {
      await sb.cleanup();
    }
  }
});

Deno.test("a removal whose push was refused is the (P) row: pulled, pushed, then clear", async () => {
  const sb = await project({ "22": { status: "In progress" } });
  try {
    await sb.commit(".specnaut/feature.json", '{ "linked_issue": 22 }\n', "feat(22): cloud shape");
    await git(sb.work, "push", "--quiet", "origin", "main");
    await sb.refusePushes();
    const first = lines((await gate(sb, "--own", "22")).stdout)[0];
    assertEquals(await reenter(sb, first), "unpushed");
    const g = lines((await gate(sb, "--own", "22")).stdout);
    assertEquals(g.map((l) => l.split(" ").slice(0, 2).join(" ")), [
      "PENDING push",
      "OWN closeout",
      "gate blocked",
    ]);
    await Deno.writeTextFile(join(sb.root, "allow"), "");
    assertEquals(await resume(sb, "22"), ["gate clear"]);
    assertEquals(await status(sb, "22"), "Done");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("an unpushed commit that is not the removal is someone's work: nothing is pushed", async () => {
  // [label, what sits on the local base]: one unrelated commit; the refused removal plus another.
  for (const label of ["one unrelated commit", "the removal and one more"]) {
    const sb = await project({ "23": { status: "In progress" } });
    try {
      await land(sb, `{ "feature_directory": "${DIR}", "linked_issue": 23 }\n`, "feat(23): x");
      if (label === "the removal and one more") {
        await sb.refusePushes();
        const own = lines((await gate(sb, "--own", "23")).stdout)[0];
        assertEquals(await reenter(sb, own), "unpushed");
        await Deno.writeTextFile(join(sb.root, "allow"), "");
      }
      await sb.commit("notes.md", "mine\n", "chore: local work");
      const tip = await git(sb.remote, "rev-parse", "main");
      const out = await resume(sb, "23");
      assert(out.some((l) => l.startsWith("PENDING push ")), `${label}: ${out.join("\n")}`);
      assertEquals(await git(sb.remote, "rev-parse", "main"), tip, `${label}: origin moved`);
    } finally {
      await sb.cleanup();
    }
  }
});

Deno.test("an epic with one open child: the shipped child closes, the epic stays open, its spec is kept", async () => {
  const sb = await project({
    "40": { status: "In progress" },
    "41": { status: "In progress", parent: "40" },
    "42": { status: "In progress", parent: "40" },
  });
  try {
    await land(
      sb,
      `{ "feature_directory": "${DIR}", "linked_issue": 40 }\n`,
      "feat(T01): one (#41)",
      "Epic: #40",
    );
    const out = await resume(sb, "40");
    assertEquals(out[0].split(" ").slice(0, 3).join(" "), "OWN closeout 40");
    assertEquals([await status(sb, "41"), await status(sb, "42"), await status(sb, "40")], [
      "Done",
      "In progress",
      "In progress",
    ]);
    assertEquals(await git(sb.remote, "ls-tree", "--name-only", "main", "--", DIR), DIR);
    // Once the last child is done, the same resume closes the epic and clears.
    await backlog(sb, "move.sh", "42", "Done");
    assertEquals(await resume(sb, "40"), ["gate clear"]);
    assertEquals(await status(sb, "40"), "Done");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("PARTIAL over a closed item settles without closing anything", async () => {
  const sb = await project({ "50": { status: "Done" }, "51": { status: "In progress" } });
  try {
    await land(
      sb,
      `{ "feature_directory": "${DIR}", "linked_issue": 50, "delivery": "partial" }\n`,
      "feat(50): x",
    );
    const before = await Deno.readTextFile(join(sb.work, ".specnaut/backlog/050-item.md"));
    const own = lines((await gate(sb, "--own", "50")).stdout)[0];
    assert(own.startsWith("OWN partial 50 "), own);
    assertEquals(await reenter(sb, own), "removed");
    assertEquals(lines((await gate(sb)).stdout), ["gate clear"]);
    assertEquals(await Deno.readTextFile(join(sb.work, ".specnaut/backlog/050-item.md")), before);
    assertEquals(await status(sb, "51"), "In progress");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a hold on 20 keeps the marker; a 21 still removes it (FR-7)", async () => {
  if (Deno.build.os === "windows") return; // the stand-in is a bash script
  for (const [code, want] of [[20, "held"], [21, "removed"]] as const) {
    const sb = await project({ "60": { status: "In progress" } });
    try {
      await land(sb, `{ "feature_directory": "${DIR}", "linked_issue": 60 }\n`, "feat(60): x");
      // The tracker's answer, stood in for: the move did not confirm (20), or a card did not move (21).
      await Deno.writeTextFile(
        join(sb.work, ".specnaut/scripts/backlog/close-shipped.sh"),
        `#!/usr/bin/env bash\nexit ${code}\n`,
      );
      await git(sb.work, "commit", "--quiet", "-am", "chore: stand-in");
      await git(sb.work, "push", "--quiet", "origin", "main");
      const own = lines((await gate(sb, "--own", "60")).stdout)[0];
      assertEquals(await reenter(sb, own), want);
      const after = lines((await gate(sb)).stdout)[0];
      assertEquals(after.split(" ")[0], code === 20 ? "PENDING" : "gate", after);
    } finally {
      await sb.cleanup();
    }
  }
});

Deno.test("FENCED: no backlog script runs without the answer; with it, the closeout proceeds", async () => {
  const sb = await project({ "70": { status: "In progress" } });
  try {
    await sb.commit(".specnaut/backlog-config.yml", "repo: acme/one\n", "chore: a board");
    await land(sb, `{ "feature_directory": "${DIR}", "linked_issue": 70 }\n`, "feat(70): x");
    await sb.commit(".specnaut/backlog-config.yml", "repo: acme/two\n", "chore: another board");
    await git(sb.work, "push", "--quiet", "origin", "main");
    const tip = await git(sb.remote, "rev-parse", "main");
    // No yes: resume stops on the FENCED line, and no backlog script has run.
    const stopped = await resume(sb, "70");
    assert(stopped[0].startsWith("FENCED closeout 70 "), stopped.join("\n"));
    assertEquals(await status(sb, "70"), "In progress");
    assertEquals(await git(sb.remote, "rev-parse", "main"), tip);
    // A yes: the rerun with --fence-ack goes on to the closeout.
    assertEquals(await resume(sb, "70", Infinity, true), ["gate clear"]);
    assertEquals(await status(sb, "70"), "Done");
    assertEquals(lines((await gate(sb)).stdout), ["gate clear"]);
  } finally {
    await sb.cleanup();
  }
});
