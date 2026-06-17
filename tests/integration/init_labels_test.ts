import { assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { fromFileUrl, join } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

async function runSpecnaut(
  args: string[],
  opts: { cwd: string },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const p = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-run",
      "--allow-env",
      MAIN,
      ...args,
    ],
    cwd: opts.cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await p.output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-labels-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("init --backlog github scaffolds ensure-labels.sh", async () => {
  await withTempDir(async (parent) => {
    const r = await runSpecnaut(
      [
        "init",
        "demo",
        "--no-git",
        "--ai",
        "claude",
        "--backlog",
        "github",
        "--backlog-url",
        "https://github.com/orgs/example/projects/1",
      ],
      { cwd: parent },
    );
    assertEquals(r.code, 0, r.stderr);

    const script = join(parent, "demo/.specnaut/scripts/backlog/ensure-labels.sh");
    assertEquals(await exists(script), true);

    const body = await Deno.readTextFile(script);
    assertStringIncludes(body, "gh label create");
    assertStringIncludes(body, "gh label list");
    // The 7 canonical labels should each appear in the body.
    for (
      const label of [
        "security",
        "refactor",
        "docs",
        "tech-debt",
        "dx",
        "performance",
        "dependency",
      ]
    ) {
      assertStringIncludes(body, `"${label}"`);
    }
    // Idempotency hint: the helper short-circuits when the label is present.
    assertStringIncludes(body, "already present");

    // The shared LABELS.md reference doc lands alongside the install.
    assertEquals(
      await exists(join(parent, "demo/.specnaut/LABELS.md")),
      true,
    );

    // Script must be executable.
    const stat = await Deno.stat(script);
    if (Deno.build.os !== "windows") {
      assertEquals(((stat.mode ?? 0) & 0o111) !== 0, true);
    }
  });
});

Deno.test("init --backlog gitlab scaffolds ensure-labels.sh (glab path)", async () => {
  await withTempDir(async (parent) => {
    const r = await runSpecnaut(
      [
        "init",
        "demo",
        "--no-git",
        "--ai",
        "claude",
        "--backlog",
        "gitlab",
        "--backlog-url",
        "https://gitlab.com/example/project",
      ],
      { cwd: parent },
    );
    assertEquals(r.code, 0, r.stderr);

    const script = join(parent, "demo/.specnaut/scripts/backlog/ensure-labels.sh");
    assertEquals(await exists(script), true);

    const body = await Deno.readTextFile(script);
    assertStringIncludes(body, "glab label create");
    assertStringIncludes(body, "glab label list");

    assertEquals(
      await exists(join(parent, "demo/.specnaut/LABELS.md")),
      true,
    );
  });
});

Deno.test("init --backlog local does NOT scaffold ensure-labels.sh", async () => {
  await withTempDir(async (parent) => {
    const r = await runSpecnaut(
      ["init", "demo", "--no-git", "--ai", "claude", "--backlog", "local"],
      { cwd: parent },
    );
    assertEquals(r.code, 0, r.stderr);

    // No labels script for the local backend — there are no labels.
    assertEquals(
      await exists(join(parent, "demo/.specnaut/scripts/backlog/ensure-labels.sh")),
      false,
    );

    // LABELS.md still ships as a reference (mentions the local-tagging convention).
    assertEquals(
      await exists(join(parent, "demo/.specnaut/LABELS.md")),
      true,
    );
  });
});
