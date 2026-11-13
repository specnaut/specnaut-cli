import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { baseImage } from "../../src/cli/handlers/sandbox_host_deps.ts";
import { readDevcontainerImage } from "../../src/infrastructure/devcontainer_image.ts";
import { GitObjects } from "../../src/infrastructure/git_object_reader.ts";
import { git, initRepo, tempDir } from "../helpers/git_fixture.ts";

/**
 * The container image a sandboxed run uses: read from the base branch's tip as git objects, so an
 * edit to the work tree's devcontainer never changes it.
 */

const PINNED = `acme/dev@sha256:${"a".repeat(64)}`;
const OTHER = `acme/other@sha256:${"b".repeat(64)}`;

/** A project on `main` whose `origin/HEAD` names main, as a clone has it; its tip after `files`. */
async function withProject(
  files: Record<string, string>,
  fn: (root: string, tip: string) => Promise<void>,
): Promise<void> {
  const base = await tempDir("devcontainer-");
  try {
    const root = join(base, "project");
    await Deno.mkdir(root);
    await initRepo(root);
    for (const [path, text] of Object.entries(files)) {
      await Deno.mkdir(join(root, path, ".."), { recursive: true });
      await Deno.writeTextFile(join(root, path), text);
    }
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-q", "--allow-empty", "-m", "base"]);
    await git(base, ["init", "-q", "--bare", "-b", "main", "origin.git"]);
    await git(root, ["remote", "add", "origin", join(base, "origin.git")]);
    await git(root, ["push", "-q", "origin", "main"]);
    await git(root, ["remote", "set-head", "origin", "main"]);
    await fn(root, await git(root, ["rev-parse", "HEAD"]));
  } finally {
    await Deno.remove(base, { recursive: true });
  }
}

const image = (ref: string) => `// a devcontainer\n{\n  "image": "${ref}", // pinned\n}\n`;

Deno.test("the image is the base tip's: an edit to the work tree's devcontainer changes nothing", () =>
  withProject({ ".devcontainer/devcontainer.json": image(PINNED) }, async (root) => {
    assertEquals(await baseImage(root), { kind: "pinned", ref: PINNED });
    await Deno.writeTextFile(join(root, ".devcontainer", "devcontainer.json"), image(OTHER));
    await Deno.writeTextFile(join(root, ".devcontainer.json"), image(OTHER));
    assertEquals(await baseImage(root), { kind: "pinned", ref: PINNED });
    await Deno.remove(join(root, ".devcontainer"), { recursive: true });
    assertEquals(await baseImage(root), { kind: "pinned", ref: PINNED });
  }));

Deno.test("a devcontainer only the work tree holds gives no image", () =>
  withProject({ "a.txt": "a\n" }, async (root) => {
    await Deno.writeTextFile(join(root, ".devcontainer.json"), image(PINNED));
    assertEquals(await baseImage(root), { kind: "none", why: "no devcontainer" });
  }));

Deno.test("outside a repository, or with no base tip, there is no image, and why", async () => {
  const dir = await tempDir("devcontainer-");
  try {
    const outside = await baseImage(dir);
    assert(
      outside.kind === "none" && outside.why.startsWith("no base to read"),
      JSON.stringify(outside),
    );
    const git = { readFile: () => Promise.reject(new Error("unreached")) };
    assertEquals(await readDevcontainerImage(git, null), {
      kind: "none",
      why: "the base branch's tip is unknown",
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("at the base: .devcontainer.json when the folder has none, a pinned image only", () =>
  withProject({ ".devcontainer.json": `{ "image": "acme/dev:latest" }` }, async (root, tip) => {
    assertEquals(await readDevcontainerImage(await GitObjects.open(root), tip), {
      kind: "none",
      why: "the devcontainer image is not pinned by digest",
    });
  }));

Deno.test("at the base: unreadable or too large gives no image, and why", async () => {
  await withProject({ ".devcontainer.json": "{ not json" }, async (root, tip) => {
    const garbled = await readDevcontainerImage(await GitObjects.open(root), tip);
    assert(garbled.kind === "none" && garbled.why.startsWith(".devcontainer.json is not JSON"));
  });
  const big = " ".repeat(1024 * 1024 + 1);
  await withProject({ ".devcontainer.json": big }, async (root, tip) => {
    const over = await readDevcontainerImage(await GitObjects.open(root), tip);
    assert(over.kind === "none" && over.why.includes("over 1048576 bytes"), JSON.stringify(over));
  });
});

Deno.test({
  name: "at the base: a devcontainer that is a link is not followed",
  ignore: Deno.build.os === "windows",
  fn: () =>
    withProject({ "real.json": `{ "image": "${PINNED}" }` }, async (root) => {
      await Deno.symlink("real.json", join(root, ".devcontainer.json"));
      await git(root, ["add", "-A"]);
      await git(root, ["commit", "-q", "-m", "link"]);
      await git(root, ["push", "-q", "origin", "main"]);
      assertEquals(await baseImage(root), {
        kind: "none",
        why: ".devcontainer.json at the base is not a regular file",
      });
    }),
});
