import { assertEquals } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { git, run, sandbox } from "./git_sandbox.ts";
import { DIR, gate, land, lines, marker, settle } from "./wip_audit_gate_fixture.ts";

/** cli#760 — the intake gate under --since, FENCED and its anchor, PARTIAL, and an epic marker. */

Deno.test("INVALID under --since: a directory older than the item, though a newer commit names it", async () => {
  const sb = await sandbox();
  try {
    await Deno.mkdir(join(sb.work, DIR), { recursive: true });
    await Deno.writeTextFile(join(sb.work, DIR, "plan.md"), "# an old plan\n");
    await git(sb.work, "add", DIR);
    const old = await run("git", ["commit", "--quiet", "-m", "plan: imported long ago"], sb.work, {
      GIT_COMMITTER_DATE: "@1600000000 +0000",
    });
    assertEquals(old.code, 0, old.stderr);
    const sha = await sb.commit(".specnaut/feature.json", marker(44), "feat(44): now");
    await git(sb.work, "push", "--quiet", "origin", "main");
    assertEquals(
      lines((await gate(sb, "--since", "44@1700000000")).stdout)[0],
      "INVALID closeout 44",
    );
    assertEquals(
      lines((await gate(sb, "--since", "44@1500000000")).stdout)[0],
      `PENDING closeout 44 ${DIR} ${sha}`,
    );
  } finally {
    await sb.cleanup();
  }
});

Deno.test("FENCED: the config moved since the last removal; --own alone does not cross it, --fence-ack does", async () => {
  const sb = await sandbox();
  try {
    await land(sb, marker(1), "feat(1): first");
    await settle(sb);
    await sb.commit(
      ".specnaut/backlog-config.yml",
      "repo: acme/other\n",
      "chore: point at another board",
    );
    const sha = await land(sb, marker(51), "feat(51): the landing");
    const r = await gate(sb, "--own", "51");
    assertEquals([r.code, lines(r.stdout)], [4, [
      `FENCED closeout 51 ${DIR} ${sha}`,
      "gate blocked",
    ]]);
    const ack = await gate(sb, "--own", "51", "--fence-ack", "51");
    assertEquals([ack.code, lines(ack.stdout)], [0, [
      `OWN closeout 51 ${DIR} ${sha}`,
      "gate clear",
    ]]);
    assertEquals(
      lines((await gate(sb, "--fence-ack", "51")).stdout)[0],
      `PENDING closeout 51 ${DIR} ${sha}`,
    );
    assertEquals(
      lines((await gate(sb, "--fence-ack", "5")).stdout)[0],
      `FENCED closeout 51 ${DIR} ${sha}`,
    );
  } finally {
    await sb.cleanup();
  }
});

Deno.test("not FENCED: the config is unchanged since the last removal, though it changed before it", async () => {
  const sb = await sandbox();
  try {
    await sb.commit(".specnaut/backlog-config.yml", "repo: acme/first\n", "chore: a board");
    await land(sb, marker(1), "feat(1): first");
    await sb.commit(".specnaut/backlog-config.yml", "repo: acme/second\n", "chore: another board");
    await settle(sb);
    const sha = await land(sb, marker(52), "feat(52): x");
    assertEquals(lines((await gate(sb)).stdout)[0], `PENDING closeout 52 ${DIR} ${sha}`);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("FENCED: a removal that also touched a file outside .specnaut/, or edited the config, is no anchor", async () => {
  // [what the removal commit does besides deleting the marker and its directory]
  for (const [label, also] of [["README.md deleted", "rm"], ["the config edited", "edit"]]) {
    const sb = await sandbox();
    try {
      await sb.commit(".specnaut/backlog-config.yml", "repo: acme/first\n", "chore: a board");
      await land(sb, marker(1), "feat(1): first");
      if (also === "rm") {
        await sb.commit(".specnaut/backlog-config.yml", "repo: acme/second\n", "chore: b");
      }
      await git(
        sb.work,
        "rm",
        "-r",
        "--quiet",
        "--",
        DIR,
        ".specnaut/feature.json",
        ...(also === "rm" ? ["README.md"] : []),
      );
      if (also === "edit") {
        await Deno.writeTextFile(
          join(sb.work, ".specnaut/backlog-config.yml"),
          "repo: acme/second\n",
        );
        await git(sb.work, "add", ".specnaut/backlog-config.yml");
      }
      await git(sb.work, "commit", "--quiet", "-m", "chore: not remove-spec's shape");
      await git(sb.work, "push", "--quiet", "origin", "main");
      // The fallback anchor, the parent of the oldest add, predates the second board.
      await land(sb, marker(53), "feat(53): x");
      assertEquals(lines((await gate(sb)).stdout)[0].split(" ")[0], "FENCED", label);
    } finally {
      await sb.cleanup();
    }
  }
});

Deno.test("FENCED, never exit 3: no removal yet and the config moved since the first marker", async () => {
  const sb = await sandbox();
  try {
    await sb.commit(".specnaut/backlog-config.yml", "repo: acme/first\n", "chore: a board");
    await land(sb, marker(54), "feat(54): x");
    assertEquals(lines((await gate(sb)).stdout)[0].split(" ")[0], "PENDING");
    await sb.commit(".specnaut/backlog-config.yml", "repo: acme/second\n", "chore: another board");
    await git(sb.work, "push", "--quiet", "origin", "main");
    const r = await gate(sb);
    assertEquals([r.code, lines(r.stdout)[0].split(" ")[0]], [4, "FENCED"], r.stderr);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("FENCED, never exit 3: a shallow clone lacks the anchor's parent", async () => {
  const sb = await sandbox();
  try {
    await land(sb, marker(55), "feat(55): x");
    const shallow = join(sb.root, "shallow");
    await git(sb.root, "clone", "--quiet", "--depth", "1", toFileUrl(sb.remote).href, shallow);
    await git(shallow, "remote", "set-head", "origin", "main");
    const r = await run("bash", [".specnaut/scripts/bash/wip-audit.sh", "--gate"], shallow);
    assertEquals([r.code, lines(r.stdout)[0].split(" ")[0]], [4, "FENCED"], r.stderr);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("PARTIAL: a --no-close slice, OWN partial under --own, never a pending closeout", async () => {
  const sb = await sandbox();
  try {
    const sha = await land(sb, marker(61, ', "delivery": "partial"'), "feat(61): first slice");
    assertEquals(lines((await gate(sb)).stdout), [
      `PARTIAL closeout 61 ${DIR} ${sha}`,
      "gate blocked",
    ]);
    const own = await gate(sb, "--own", "61");
    assertEquals([own.code, lines(own.stdout)], [0, [
      `OWN partial 61 ${DIR} ${sha}`,
      "gate clear",
    ]]);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("an epic marker reads its sha from the first landed child, its subjects never naming the epic", async () => {
  const sb = await sandbox();
  try {
    await Deno.mkdir(join(sb.work, DIR), { recursive: true });
    await Deno.writeTextFile(join(sb.work, DIR, "plan.md"), "# plan\n");
    await git(sb.work, "add", DIR);
    const first = await sb.commit(
      ".specnaut/feature.json",
      marker(70),
      "feat(T01): one (#71)",
      "Epic: #70",
    );
    await sb.commit("b", "b\n", "feat(T02): two (#72)", "Epic: #70");
    await git(sb.work, "push", "--quiet", "origin", "main");
    assertEquals(lines((await gate(sb)).stdout)[0], `PENDING closeout 70 ${DIR} ${first}`);
    await sb.commit(
      ".specnaut/feature.json",
      marker(70, ', "delivery": "partial"'),
      "fix(T02): two (#72)",
      "Epic: #70",
    );
    await git(sb.work, "push", "--quiet", "origin", "main");
    assertEquals(lines((await gate(sb)).stdout)[0], `PARTIAL closeout 70 ${DIR} ${first}`);
    assertEquals(lines((await gate(sb, "--own", "70")).stdout), [
      `OWN partial 70 ${DIR} ${first}`,
      "gate clear",
    ]);
  } finally {
    await sb.cleanup();
  }
});
