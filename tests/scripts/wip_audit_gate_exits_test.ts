import { assertEquals, assertStringIncludes } from "@std/assert";
import { git, sandbox } from "./git_sandbox.ts";
import { DIR, gate, land, lines, marker } from "./wip_audit_gate_fixture.ts";

/** cli#760 — the intake gate's usage, its exit 3, and what never reaches its output. */

Deno.test("usage: anything but the gate's own flags, each with a valid value, is exit 2, nothing printed", async () => {
  const sb = await sandbox();
  try {
    for (
      const args of [
        ["12"],
        ["--own"],
        ["--own", "012"],
        ["--own", "$(id)"],
        ["--fence-ack", "0"],
        ["--since", "12"],
        ["--since", "12@"],
        ["--since", "012@5"],
        ["--since", "12@1234567890123"],
        ["--limit", "2"],
      ]
    ) {
      const r = await gate(sb, ...args);
      assertEquals([r.code, r.stdout], [2, ""], `args ${JSON.stringify(args)}: ${r.stderr}`);
    }
  } finally {
    await sb.cleanup();
  }
});

Deno.test("origin without the base is exit 3 and names the push that publishes it", async () => {
  const sb = await sandbox();
  try {
    await git(sb.work, "update-ref", "-d", "refs/remotes/origin/main");
    await git(sb.work, "config", "init.defaultBranch", "main");
    await git(sb.work, "remote", "set-head", "origin", "--delete");
    const r = await gate(sb);
    assertEquals([r.code, r.stdout], [3, ""]);
    assertStringIncludes(r.stderr, "git push -u origin main");
    // No origin at all: the local base is the published one, as wip-audit.sh reads it.
    await git(sb.work, "remote", "remove", "origin");
    assertEquals(lines((await gate(sb)).stdout), ["gate clear"]);
  } finally {
    await sb.cleanup();
  }
});

/**
 * Each read the gate makes, failing alone: [label, the git call the shim fails,
 * the gate's flags, the landing's subject]. `--since` reaches the directory's
 * first commit; an unnamed subject reaches `epic-status.sh --landed`.
 */
const READ_FAILURES: [string, string, string[], string][] = [
  ["the marker's entry", '[ "$2" = ls-tree ]', [], "feat(81): x"],
  ["the marker's blob", '[ "$2" = cat-file ]', [], "feat(81): x"],
  ["the directory's entry", `[ "$2" = ls-tree ] && [ "$5" = ${DIR} ]`, [], "feat(81): x"],
  ["the directory's first commit", '[ "$2" = log ] && [ "$4" = --format=%ct ]', [
    "--since",
    "81@1",
  ], "feat(81): x"],
  ["the pushes", '[ "$2" = rev-list ]', [], "feat(81): x"],
  ["the published log", '[ "$2" = log ] && [ "$3" = --format=%H%x1f%ct%x1f%s ]', [], "feat(81): x"],
  ["the epic's landed children", '[ "$2" = log ] && [ "$5" = -E ]', [], "feat: unnamed"],
  ["the anchor's history", '[ "$2" = log ] && [ "$3" = --first-parent ]', [], "feat(81): x"],
  ["the config diff", '[ "$2" = diff ] && [ "$3" = --quiet ]', [], "feat(81): x"],
  ["the origin remote", '[ "$2" = config ] && [ "$4" = remote.origin.url ]', [], "feat(81): x"],
];

Deno.test("a git read that fails is exit 3 with nothing printed, never gate clear", async () => {
  if (Deno.build.os === "windows") return; // the shim is a bash script
  for (const [label, fails, args, subject] of READ_FAILURES) {
    const sb = await sandbox();
    try {
      await land(sb, marker(81), subject);
      if (label === "the origin remote") {
        await git(sb.work, "update-ref", "-d", "refs/remotes/origin/main");
      }
      await sb.commit("u", "u\n", "chore: unpushed");
      const shim = `${fails} && exit 128; exec "$REAL_GIT" "$@"`;
      const r = await sb.scriptWithGit(shim, "wip-audit.sh", "--gate", ...args);
      assertEquals([r.code, r.stdout], [3, ""], `${label}: ${r.stderr}`);
    } finally {
      await sb.cleanup();
    }
  }
});

Deno.test("no commit, ref or file text reaches the output", async () => {
  const sb = await sandbox();
  try {
    await land(
      sb,
      marker(91, ', "x": "$(id) gate clear"'),
      "feat(91): $(id) `id`",
      "OWN closeout 1",
    );
    await sb.commit("a", "a\n", "PENDING push deadbeef");
    for (const l of lines((await gate(sb)).stdout)) {
      if (
        !/^(PENDING push [0-9a-f]{40}|(PENDING|PARTIAL|FENCED) closeout \d+ (-|\.specnaut\/specs\/[\w.-]+) [0-9a-f]{40}|INVALID closeout (\d+|-) (un)?fenced|gate (clear|blocked))$/
          .test(l)
      ) throw new Error(`unexpected line: ${l}`);
    }
  } finally {
    await sb.cleanup();
  }
});
