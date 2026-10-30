import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  assertInsideProject,
  resolveProjectRoot,
  resolveTarget,
} from "../../src/infrastructure/fs_containment.ts";
import { symlinkTest } from "../helpers/link_text.ts";

/** A project directory beside an `outside/` sibling, both under one temp root. */
async function box(): Promise<{ root: string; proj: string; outside: string }> {
  const root = await Deno.makeTempDir({ prefix: "containment-" });
  const proj = join(root, "proj");
  const outside = join(root, "outside");
  await Deno.mkdir(proj);
  await Deno.mkdir(outside);
  return { root, proj, outside };
}

symlinkTest("a temp-dir project is inside itself", async () => {
  // The assertion that fails FIRST if the two sides are resolved differently.
  // `makeTempDir` returns a path under /var on macOS, which is a symlink to
  // /private/var — so a lexical root against a realPath'd candidate reports
  // every file in the project as outside it, and the whole suite goes red.
  const { root, proj } = await box();
  try {
    const r = await resolveProjectRoot(proj);
    await assertInsideProject(r, join(proj, "a/b.md"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("an absent destination is judged on its parent", async () => {
  const { root, proj } = await box();
  try {
    const r = await resolveProjectRoot(proj);
    await assertInsideProject(r, join(proj, "not-written-yet.md"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("a symlink resolving INSIDE the project is allowed", async () => {
  // FR-005 / SC-003. This is the case the existing skipIfExists guard was
  // written to protect — a project consolidating its context files — and the
  // one an over-correction into a blanket symlink refusal breaks.
  const { root, proj } = await box();
  try {
    await Deno.writeTextFile(join(proj, "real.md"), "x");
    await Deno.symlink(join(proj, "real.md"), join(proj, "link.md"));
    const r = await resolveProjectRoot(proj);
    await assertInsideProject(r, join(proj, "link.md"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("a leaf symlink resolving outside is refused", async () => {
  // Shape B. The plan's first algorithm — resolve the PARENT and append the
  // leaf — says "inside" here, because the parent is a normal in-project
  // directory. Measured before this test existed: rel="link.md", contained,
  // allowed, and the write landed on the victim.
  const { root, proj, outside } = await box();
  try {
    await Deno.writeTextFile(join(outside, "victim.md"), "ORIGINAL");
    await Deno.symlink(join(outside, "victim.md"), join(proj, "link.md"));
    const r = await resolveProjectRoot(proj);
    const err = await assertRejects(() => assertInsideProject(r, join(proj, "link.md")));
    assert(err instanceof Error);
    assert(err.message.includes("leaves the project"), err.message);
    assert(err.message.includes("victim.md"), "the message must name where it resolved to");
    assert(err.message.includes(r), "and the resolved root, so a widened root is visible");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("a symlinked ANCESTOR is refused", async () => {
  // Shape A and C. The dest is a clean relative path the whole way; the escape
  // is one directory up.
  const { root, proj, outside } = await box();
  try {
    await Deno.symlink(outside, join(proj, ".claude"));
    const r = await resolveProjectRoot(proj);
    await assertRejects(() => assertInsideProject(r, join(proj, ".claude/x.md")));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("a DANGLING symlink is judged on where it points, not treated as absent", async () => {
  // The trap in the obvious fix. "Try realPath, fall back to the parent on
  // NotFound" cannot tell a dangling link from a file that does not exist, and
  // writeTextFile on a dangling link CREATES the target — so the fallback is
  // the escape. Measured: Deno.realPath does not even throw on a dangling link
  // on macOS, so a predicate written that way behaves differently per platform.
  const { root, proj, outside } = await box();
  try {
    await Deno.symlink(join(outside, "does-not-exist.md"), join(proj, "dangling.md"));
    const r = await resolveProjectRoot(proj);
    await assertRejects(() => assertInsideProject(r, join(proj, "dangling.md")));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("a dangling symlink pointing INSIDE is still allowed", async () => {
  // The other half of the rule: a dangling link is judged on its target, not
  // refused for being dangling. Without this, the previous test passes against
  // a blanket "refuse every unresolvable link".
  const { root, proj } = await box();
  try {
    await Deno.symlink(join(proj, "not-yet.md"), join(proj, "dangling-in.md"));
    const r = await resolveProjectRoot(proj);
    await assertInsideProject(r, join(proj, "dangling-in.md"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("resolveTarget follows a chain of links to its end", async () => {
  const { root, proj, outside } = await box();
  try {
    await Deno.writeTextFile(join(outside, "end.md"), "x");
    await Deno.symlink(join(outside, "end.md"), join(outside, "mid.md"));
    await Deno.symlink(join(outside, "mid.md"), join(proj, "start.md"));
    const resolved = await resolveTarget(join(proj, "start.md"));
    assertEquals(resolved, await Deno.realPath(join(outside, "end.md")));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("the filesystem root is refused as a project", async () => {
  await assertRejects(() => resolveProjectRoot("/"));
});

symlinkTest("the home directory is refused as a project", async () => {
  const home = Deno.env.get("HOME");
  if (home === undefined || home === "") return; // not applicable on this host
  await assertRejects(() => resolveProjectRoot(home));
});

symlinkTest(
  "a relative leaf link under a symlinked parent is resolved the way the kernel does",
  async () => {
    // The CRITICAL the review reproduced, and the sharpest case in this file.
    //
    //     proj/.claude      -> outside/dir
    //     outside/dir/x.md  -> ../victim.md
    //
    // `join` collapses `..` LEXICALLY; the kernel resolves each component in turn
    // and applies `..` from wherever it actually landed. Joining `../victim.md`
    // against the unresolved `proj/.claude` gives `proj/victim.md` — inside. The
    // kernel gives `outside/victim.md` — not. Measured before the fix:
    // `writeBundle` did not refuse, and the file outside was overwritten and
    // chmod 755'd.
    //
    // Two symlinks, both committable to a repository, and they defeated the
    // resolver at the centre of every guard in this change.
    const { root, proj, outside } = await box();
    try {
      await Deno.mkdir(join(outside, "dir"));
      await Deno.writeTextFile(join(outside, "victim.md"), "SENTINEL");
      await Deno.symlink(join(outside, "dir"), join(proj, ".claude"));
      await Deno.symlink("../victim.md", join(outside, "dir/x.md"));

      const abs = join(proj, ".claude/x.md");
      assertEquals(
        await resolveTarget(abs),
        await Deno.realPath(abs),
        "the resolver must agree with the kernel, which is the only definition of where a write lands",
      );
      const r = await resolveProjectRoot(proj);
      await assertRejects(() => assertInsideProject(r, abs));
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);

symlinkTest("a relative leaf link that stays inside is still allowed", async () => {
  // The positive control for the case above: `..` in a link target is not
  // itself the defect, and refusing every relative link would satisfy the
  // assertion above while breaking ordinary layouts.
  const { root, proj } = await box();
  try {
    await Deno.mkdir(join(proj, "a"));
    await Deno.writeTextFile(join(proj, "real.md"), "x");
    await Deno.symlink("../real.md", join(proj, "a/link.md"));
    await assertInsideProject(await resolveProjectRoot(proj), join(proj, "a/link.md"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest(
  "a symlink cycle is refused with a message about the project, not about realpath",
  async () => {
    // Not an escape — the kernel refuses a cycle too — but it surfaced as a raw
    // `FilesystemLoop` naming `realpath`, which tells a user nothing about their
    // own tree. Narrow on purpose: every other error still propagates, so a
    // permission problem is never reported as a bad layout.
    const { root, proj } = await box();
    try {
      await Deno.symlink(join(proj, "b"), join(proj, "a"));
      await Deno.symlink(join(proj, "a"), join(proj, "b"));
      const r = await resolveProjectRoot(proj);
      const err = await assertRejects(() => assertInsideProject(r, join(proj, "a")));
      assert(err instanceof Error);
      assert(err.message.includes("cycle"), err.message);
      assert(err.message.includes(join(proj, "a")), "and names the path");
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);

symlinkTest("a CHAIN of symlinks is followed to its end, not one hop", async () => {
  // Round 2's CRITICAL, and the round-1 defect one hop further out — same
  // function, surviving the round-1 fix.
  //
  //     proj/a -> proj/b
  //     proj/b -> outside/target      (target absent)
  //
  // Following one hop landed on `proj/b` and handed it to the ancestor walk,
  // which treats an absent second hop as "missing" and re-appends it lexically
  // — so the verdict was `proj/b`, inside, while a write to `proj/a` created
  // `outside/target`. Reproduced before the fix.
  //
  // The reason to iterate rather than to follow two hops is that any fixed
  // depth is the same bug waiting for one more link.
  const { root, proj, outside } = await box();
  try {
    await Deno.symlink(join(proj, "b"), join(proj, "a"));
    await Deno.symlink(join(outside, "target"), join(proj, "b"));
    assertEquals(
      await resolveTarget(join(proj, "a")),
      join(await Deno.realPath(outside), "target"),
    );
    const r = await resolveProjectRoot(proj);
    await assertRejects(() => assertInsideProject(r, join(proj, "a")));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("a long chain that stays inside is still allowed", async () => {
  // The positive control for the loop. A hop cap that refused ordinary depth,
  // or a loop that gave up early, would satisfy the assertion above.
  const { root, proj } = await box();
  try {
    await Deno.writeTextFile(join(proj, "real.md"), "x");
    let prev = join(proj, "real.md");
    for (let i = 0; i < 8; i++) {
      await Deno.symlink(prev, join(proj, `h${i}.md`));
      prev = join(proj, `h${i}.md`);
    }
    assertEquals(await resolveTarget(prev), await Deno.realPath(join(proj, "real.md")));
    await assertInsideProject(await resolveProjectRoot(proj), prev);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
