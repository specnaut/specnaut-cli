import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { BOARD_SCRIPTS, FULL_BODY, project, run, TEMPLATES } from "./groom_sandbox.ts";

/**
 * US4 / FR-005 — the local backend's `groom-verify.sh`, end to end on real
 * task files, and the groom calling it. The remote backends, against stubbed
 * CLIs, are in `groom_verify_remote_test.ts`.
 */

function taskFile(fm: Record<string, string>, body: string): string {
  const head = Object.entries(fm).map(([k, v]) => `${k}:${v === "" ? "" : " " + v}`);
  return ["---", ...head, "---", "", body, ""].join("\n");
}

Deno.test("local: reads the task file's frontmatter and body", async () => {
  const p = await project("local", ["add.sh", "render-index.sh", "clarify-comment.sh"]);
  try {
    const backlog = join(p.dir, ".specnaut/backlog");
    await Deno.mkdir(backlog, { recursive: true });
    const base = { number: "", title: "t", status: "Ready", size: "M", priority: "P1" };
    await Deno.writeTextFile(
      join(backlog, "001-complete.md"),
      taskFile({ ...base, number: "001" }, FULL_BODY),
    );
    await Deno.writeTextFile(
      join(backlog, "002-two-sizes.md"),
      taskFile({ ...base, number: "002", size: '"M, L"', priority: "P4" }, FULL_BODY),
    );
    // `complexity:` is the retired key: it is not a size.
    await Deno.writeTextFile(
      join(backlog, "003-legacy.md"),
      taskFile({ ...base, number: "003", size: "", complexity: "M" }, FULL_BODY),
    );

    let r = await p.verify("1");
    assertEquals([r.code, r.stdout], [0, ""], r.stderr);

    r = await p.verify("1", "2", "3");
    assertEquals(r.code, 1, r.stderr);
    const lines = r.stdout.trim().split("\n");
    assertEquals(lines.length, 2, r.stdout);
    assertStringIncludes(lines[0], "#2: missing ");
    assertStringIncludes(lines[0], "size (2 values: L, M)");
    assertStringIncludes(lines[0], "priority (P4 is not one of");
    assertStringIncludes(lines[1], "#3: missing size (none)");
  } finally {
    await p.cleanup();
  }
});

Deno.test("local: an item made by add.sh, then clarified by clarify-comment.sh", async () => {
  const p = await project("local", ["add.sh", "render-index.sh", "clarify-comment.sh"]);
  try {
    const scripts = join(p.dir, ".specnaut/scripts/backlog");
    let r = await run("bash", [join(scripts, "add.sh"), "Page the export", FULL_BODY]);
    assertEquals(r.code, 0, r.stderr);

    // Fresh from add.sh: size and priority are written empty, status Backlog.
    r = await p.verify("1");
    assertEquals(r.code, 1, r.stderr);
    assertStringIncludes(r.stdout, "size (none)");
    assertStringIncludes(r.stdout, "priority (none)");
    assertStringIncludes(r.stdout, "outcome (not in Ready");

    const [file] = [...Deno.readDirSync(join(p.dir, ".specnaut/backlog"))].map((e) => e.name);
    const path = join(p.dir, ".specnaut/backlog", file);
    const text = await Deno.readTextFile(path);
    await Deno.writeTextFile(
      path,
      text.replace("size:\n", "size: S\n").replace("priority:\n", "priority: P2\n"),
    );
    r = await run("bash", [
      join(scripts, "clarify-comment.sh"),
      "1",
      "🤖 specnaut-groom — which tenant?",
    ]);
    assertEquals(r.code, 0, r.stderr);

    r = await p.verify("1");
    assertEquals([r.code, r.stdout], [0, ""], r.stderr);

    // An unmarked clarification is not the groom's outcome.
    await Deno.writeTextFile(
      path,
      (await Deno.readTextFile(path)).replace("🤖 specnaut-groom — ", ""),
    );
    r = await p.verify("1");
    assertEquals(r.code, 1);
  } finally {
    await p.cleanup();
  }
});

Deno.test("local: usage and unreadable items exit 2, never 'complete'", async () => {
  const p = await project("local", []);
  try {
    const backlog = join(p.dir, ".specnaut/backlog");
    await Deno.mkdir(backlog, { recursive: true });
    await Deno.writeTextFile(join(backlog, "005-no-front.md"), FULL_BODY);
    await Deno.writeTextFile(join(backlog, "006-open-front.md"), "---\nsize: M\n" + FULL_BODY);
    for (const args of [[], ["abc"], ["9"], ["5"], ["6"], ["--ready"]]) {
      const r = await p.verify(...args);
      assertEquals(r.code, 2, `${args.join(" ")} → ${r.stdout}${r.stderr}`);
      assertEquals(r.stdout, "");
    }
  } finally {
    await p.cleanup();
  }
});

// ---------------------------------------------------------------------------
// The groom calls it, and the prose no longer carries the rule
// ---------------------------------------------------------------------------

Deno.test("groom.md runs groom-verify.sh before the report and points at the rules", async () => {
  const groom = await Deno.readTextFile(join(TEMPLATES, "core/skills/task/groom.md"));
  const verify = groom.indexOf(".specnaut/scripts/backlog/groom-verify.sh");
  assert(verify > 0, "groom.md never runs groom-verify.sh");
  assert(verify < groom.indexOf("## Output format"), "the verify step must come before the report");
  assertStringIncludes(groom, ".specnaut/scripts/bash/groom-rules.sh");
  assertStringIncludes(groom, "⚠ size / priority missing");
  // The rule has one home: groom.md no longer decides when a ticket is processed.
  assert(!groom.includes("NOT considered processed until"), "groom.md still restates the rule");
});

Deno.test("every backend that ships board scripts ships groom-verify.sh", async () => {
  const manifest = JSON.parse(await Deno.readTextFile(join(TEMPLATES, "manifest.json")));
  const flat = manifest.core as Array<
    { category?: string; suffix?: string; source?: string; backend?: string }
  >;
  const backends = [...Deno.readDirSync(BOARD_SCRIPTS)].filter((e) => e.isDirectory).map((e) =>
    e.name
  ).sort();
  const shipped = flat
    .filter((e) => e.category === "backlog-script" && e.suffix === "groom-verify.sh")
    .map((e) => e.backend)
    .sort();
  assertEquals(shipped, backends);
  for (const b of backends) {
    const e = flat.find((x) => x.backend === b && x.suffix === "groom-verify.sh")!;
    assertEquals(e.source, `core/skills/task/scripts/${b}/groom-verify.sh`);
  }
  assert(
    flat.some((e) => e.category === "spec-root" && e.suffix === "scripts/bash/groom-rules.sh"),
    "groom-rules.sh is not installed",
  );
});
