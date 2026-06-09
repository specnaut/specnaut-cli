import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { FsParentWorkspaceReader } from "../../src/infrastructure/fs_parent_workspace_reader.ts";

/**
 * Builds a parent/child fixture under a fresh temp dir.
 *
 * Returns the canonical (`realPath`) parent and child paths — macOS temp dirs
 * live under a symlinked `/var` → `/private/var`, so tests must compare against
 * the canonicalised parent path the reader returns.
 */
async function fixture(
  opts: {
    parentHasSpecflow?: boolean;
    member?: string | null; // value placed in the parent deno.json workspace array
    denoJson?: string; // raw override (e.g. malformed)
    childStandalone?: boolean;
  },
): Promise<{ root: string; parent: string; child: string }> {
  const root = await Deno.makeTempDir({ prefix: "specflow-pwr-" });
  const parent = join(root, "parent");
  const child = join(parent, "child");
  await Deno.mkdir(child, { recursive: true });

  if (opts.parentHasSpecflow ?? true) {
    await Deno.mkdir(join(parent, ".specflow"), { recursive: true });
  }
  if (opts.denoJson !== undefined) {
    await Deno.writeTextFile(join(parent, "deno.json"), opts.denoJson);
  } else if (opts.member !== null && opts.member !== undefined) {
    await Deno.writeTextFile(
      join(parent, "deno.json"),
      JSON.stringify({ workspace: [opts.member] }, null, 2),
    );
  }
  if (opts.childStandalone) {
    await Deno.mkdir(join(child, ".specflow"), { recursive: true });
    await Deno.writeTextFile(join(child, ".specflow", "standalone.yml"), "");
  }

  const realParent = await Deno.realPath(parent);
  const realChild = await Deno.realPath(child);
  return { root, parent: realParent, child: realChild };
}

Deno.test("findProvidingAncestor: matches a providing ancestor (.specflow + member resolves to target)", async () => {
  const { root, parent, child } = await fixture({ member: "./child" });
  try {
    const reader = new FsParentWorkspaceReader();
    assertEquals(await reader.findProvidingAncestor(child), parent);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("findProvidingAncestor: ancestor with .specflow but non-matching member ⇒ null", async () => {
  const { root, child } = await fixture({ member: "./other" });
  try {
    const reader = new FsParentWorkspaceReader();
    assertEquals(await reader.findProvidingAncestor(child), null);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("findProvidingAncestor: matching member but no .specflow ⇒ null", async () => {
  const { root, child } = await fixture({ parentHasSpecflow: false, member: "./child" });
  try {
    const reader = new FsParentWorkspaceReader();
    assertEquals(await reader.findProvidingAncestor(child), null);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("findProvidingAncestor: relative member path is canonicalised (FR-004)", async () => {
  // Member declared as "child" (no leading ./) still resolves to the target.
  const { root, parent, child } = await fixture({ member: "child" });
  try {
    const reader = new FsParentWorkspaceReader();
    assertEquals(await reader.findProvidingAncestor(child), parent);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("findProvidingAncestor: symlinked workspace member is canonicalised (FR-004)", async () => {
  // The member is declared as a symlink that points at the real child dir.
  // Detection must canonicalise the member path (`tryRealPath(memberPath)`)
  // so the symlinked spelling still resolves to the target.
  const root = await Deno.makeTempDir({ prefix: "specflow-pwr-symlink-" });
  const parent = join(root, "parent");
  const realChildDir = join(parent, "child");
  await Deno.mkdir(realChildDir, { recursive: true });
  await Deno.mkdir(join(parent, ".specflow"), { recursive: true });
  await Deno.symlink(realChildDir, join(parent, "link"));
  await Deno.writeTextFile(
    join(parent, "deno.json"),
    JSON.stringify({ workspace: ["link"] }, null, 2),
  );
  const realParent = await Deno.realPath(parent);
  const realChild = await Deno.realPath(realChildDir);
  try {
    const reader = new FsParentWorkspaceReader();
    assertEquals(await reader.findProvidingAncestor(realChild), realParent);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("findProvidingAncestor: tolerates a malformed deno.json (treat as non-match)", async () => {
  const { root, child } = await fixture({ denoJson: "{ this is : not json" });
  try {
    const reader = new FsParentWorkspaceReader();
    assertEquals(await reader.findProvidingAncestor(child), null);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("findProvidingAncestor: missing deno.json ⇒ null", async () => {
  const { root, child } = await fixture({ member: null });
  try {
    const reader = new FsParentWorkspaceReader();
    assertEquals(await reader.findProvidingAncestor(child), null);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("findProvidingAncestor: walk to filesystem root with no provider ⇒ null", async () => {
  // A lone temp dir with no enclosing provider.
  const dir = await Deno.makeTempDir({ prefix: "specflow-pwr-solo-" });
  try {
    const reader = new FsParentWorkspaceReader();
    assertEquals(await reader.findProvidingAncestor(await Deno.realPath(dir)), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("hasStandaloneOverride: true when standalone.yml present", async () => {
  const { root, child } = await fixture({ member: "./child", childStandalone: true });
  try {
    const reader = new FsParentWorkspaceReader();
    assertEquals(await reader.hasStandaloneOverride(child), true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("hasStandaloneOverride: false when marker absent", async () => {
  const { root, child } = await fixture({ member: "./child" });
  try {
    const reader = new FsParentWorkspaceReader();
    assertEquals(await reader.hasStandaloneOverride(child), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
