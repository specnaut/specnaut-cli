// The local backend's close path (cli#702): `/task close <id> [--not-planned]`
// runs `move.sh <id> Done [--not-planned]`. A not-planned close is recorded
// as `resolution: not-planned` in the frontmatter and shown in the index;
// any later move clears it, so a reopened item never keeps a stale verdict.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { fromFileUrl, join } from "@std/path";

const LOCAL = fromFileUrl(
  new URL("../../templates/core/skills/task/scripts/local/", import.meta.url),
);
const ITEM = ".specnaut/backlog/001-drop-legacy-export.md";

/** A project with the local scripts at `.specnaut/scripts/backlog/` and one item. */
async function project(frontmatter = "status: Ready\n"): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "backlog-local-close-" });
  const scripts = join(dir, ".specnaut/scripts/backlog");
  await Deno.mkdir(scripts, { recursive: true });
  await Deno.mkdir(join(dir, ".specnaut/backlog"), { recursive: true });
  for (const name of ["move.sh", "render-index.sh"]) {
    await Deno.copyFile(join(LOCAL, name), join(scripts, name));
  }
  await Deno.writeTextFile(
    join(dir, ITEM),
    `---\nnumber: 001\ntitle: Drop the legacy export\n${frontmatter}---\n\nBody.\n`,
  );
  return dir;
}

async function move(dir: string, ...args: string[]) {
  const { code, stdout, stderr } = await new Deno.Command("bash", {
    args: [join(dir, ".specnaut/scripts/backlog/move.sh"), ...args],
    cwd: dir,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

const frontmatterOf = async (dir: string) =>
  (await Deno.readTextFile(join(dir, ITEM))).split("---\n")[1];

Deno.test("move.sh Done --not-planned records the resolution and the index shows it", async () => {
  const dir = await project();
  try {
    const r = await move(dir, "1", "Done", "--not-planned");
    assertEquals(r.code, 0, r.stderr);
    const fm = await frontmatterOf(dir);
    assertStringIncludes(fm, "status: Done\nresolution: not-planned\n");
    const index = await Deno.readTextFile(join(dir, ".specnaut/backlog.md"));
    const line = index.split("\n").find((l) => l.includes("Drop the legacy export")) ?? "";
    assertStringIncludes(line, "`not-planned`", "the index does not say it was not planned");
    assert(index.indexOf(line) > index.indexOf("## Done"), "a not-planned item sits under Done");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a plain Done, or any later move, clears a not-planned resolution", async () => {
  for (const [status, resolution] of [["Done", ""], ["Ready", ""]]) {
    const dir = await project("status: Done\nresolution: not-planned\n");
    try {
      const r = await move(dir, "1", status);
      assertEquals(r.code, 0, r.stderr);
      const fm = await frontmatterOf(dir);
      assertStringIncludes(fm, `status: ${status}\n`);
      assertEquals(fm.includes("resolution:"), resolution !== "", `${status}: ${fm}`);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  }
});

Deno.test("--not-planned is refused on any status but Done, and changes nothing", async () => {
  const dir = await project();
  try {
    const before = await Deno.readTextFile(join(dir, ITEM));
    const r = await move(dir, "1", "Ready", "--not-planned");
    assertEquals(r.code, 2);
    assertStringIncludes(r.stderr, "--not-planned");
    assertEquals(await Deno.readTextFile(join(dir, ITEM)), before);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("an item with no status line is refused, never reported as moved", async () => {
  const dir = await project("");
  try {
    const before = await Deno.readTextFile(join(dir, ITEM));
    const r = await move(dir, "1", "Done");
    assert(r.code !== 0, "a move that changed nothing exited 0");
    assert(!r.stdout.includes("✓"), `reported as moved: ${r.stdout}`);
    assertEquals(await Deno.readTextFile(join(dir, ITEM)), before);
    assertEquals(await exists(join(dir, `${ITEM}.tmp`)), false, "a temp file was left behind");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("the product-owner carries the close contract, per backend", async () => {
  const po = await Deno.readTextFile(
    fromFileUrl(new URL("../../templates/core/agents/product-owner.md", import.meta.url)),
  );
  const verb = po.split("\n- **`").find((v) => v.startsWith("close <id> [--not-planned]`**"));
  assert(verb, "product-owner.md serves no `/task close <id> [--not-planned]`");
  for (
    const backend of ["GitHub:", "GitLab", "Local: `move.sh <id> Done [--not-planned]`", "Cloud:"]
  ) {
    assertStringIncludes(verb, backend);
  }
  assertStringIncludes(verb, "--reason completed|not_planned");
});
