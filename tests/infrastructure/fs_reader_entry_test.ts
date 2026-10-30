import { assert, assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { DenoFsReader } from "../../src/infrastructure/fs_reader.ts";
import { ReadFault } from "../../src/application/read_fault.ts";
import { ContainmentRefusal, UnwalkableRefusal } from "../../src/infrastructure/fs_refusals.ts";
import {
  assertInsideProject,
  assertRemovableInProject,
  resolveProjectRoot,
} from "../../src/infrastructure/fs_containment.ts";
import type { DiskEntry } from "../../src/domain/context_link.ts";
import { CAN_LINK, makeLink, slashForm, WINDOWS } from "../helpers/link_text.ts";

/** `readEntry` reports what is at a path itself — a link as a link (cli#680). */

async function withProject(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/**
 * `readEntry` with a link's text in `/` form: the Windows leg makes its links
 * in `\` form, as the writer does, and the text is not what these tests pin.
 */
async function entryOf(dir: string, rel: string) {
  const entry = await new DenoFsReader().readEntry(dir, rel);
  return entry?.kind === "symlink" ? { ...entry, target: slashForm(entry.target) } : entry;
}

/**
 * The entry `readEntry` reports for a link. On Windows it carries
 * `windows: true`, because there `\` separates the segments of a link's text
 * and the domain must read `..\AGENTS.md` as ours (`DiskEntry`). Expected on
 * Windows only, so the POSIX legs still prove the flag is absent there.
 */
function linkEntry(target: string, resolved: string | null): DiskEntry {
  return { kind: "symlink", target, resolved, ...(WINDOWS ? { windows: true as const } : {}) };
}

Deno.test("readEntry: absent is null, a file is its content", async () => {
  await withProject(async (dir) => {
    const r = new DenoFsReader();
    assertEquals(await r.readEntry(dir, "AGENTS.md"), null);
    await Deno.writeTextFile(join(dir, "AGENTS.md"), "# A\n");
    assertEquals(await r.readEntry(dir, "AGENTS.md"), { kind: "file", content: "# A\n" });
  });
});

Deno.test("readEntry: a link is reported with its text and landing, not read through", {
  ignore: !CAN_LINK,
}, async () => {
  await withProject(async (dir) => {
    await Deno.writeTextFile(join(dir, "AGENTS.md"), "# A\n");
    await Deno.mkdir(join(dir, ".claude"));
    await makeLink("../AGENTS.md", join(dir, ".claude/CLAUDE.md"));
    assertEquals(await entryOf(dir, ".claude/CLAUDE.md"), linkEntry("../AGENTS.md", "AGENTS.md"));
  });
});

Deno.test("readEntry: a link out of the project is reported, never refused or read", {
  ignore: !CAN_LINK,
}, async () => {
  // `readText` refuses this path; `upgrade` still has to know what is there to
  // decide to replace it.
  await withProject(async (dir) => {
    const outside = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(outside, "secret.md"), "secret\n");
      await Deno.mkdir(join(dir, ".claude"));
      await makeLink(join(outside, "secret.md"), join(dir, ".claude/CLAUDE.md"));
      const entry = await new DenoFsReader().readEntry(dir, ".claude/CLAUDE.md");
      assertEquals(entry?.kind, "symlink");
      assertEquals(entry?.kind === "symlink" && entry.resolved?.startsWith(".."), true);
    } finally {
      await Deno.remove(outside, { recursive: true });
    }
  });
});

Deno.test("an ancestor link out of the project is a containment refusal, never a ReadFault", {
  ignore: WINDOWS,
}, async () => {
  await withProject(async (dir) => {
    const outside = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(outside, "constitution.md"), "# Ours\n");
      await Deno.symlink(outside, join(dir, "docs"));
      const err = await assertRejects(
        () => new DenoFsReader().readEntry(dir, "docs/constitution.md"),
        ContainmentRefusal,
      );
      assert(!(err instanceof ReadFault), "a refusal relabelled as a read fault");
    } finally {
      await Deno.remove(outside, { recursive: true });
    }
  });
});

Deno.test(
  "readEntry: a link cycle resolves to null instead of throwing",
  { ignore: !CAN_LINK },
  async () => {
    await withProject(async (dir) => {
      await makeLink("b.md", join(dir, "a.md"));
      await makeLink("a.md", join(dir, "b.md"));
      assertEquals(await entryOf(dir, "a.md"), linkEntry("b.md", null));
    });
  },
);

Deno.test("readEntry: a link through a missing directory is reported with no landing (cli#686)", {
  ignore: !CAN_LINK,
}, async () => {
  // The walk refuses to guess where `nope/AGENTS.md` lands; `readEntry` must
  // still report the link, not abort `upgrade` or `diff` over it.
  await withProject(async (dir) => {
    await Deno.mkdir(join(dir, ".claude"));
    await makeLink("nope/AGENTS.md", join(dir, ".claude/CLAUDE.md"));
    assertEquals(await entryOf(dir, ".claude/CLAUDE.md"), linkEntry("nope/AGENTS.md", null));
  });
});

Deno.test(
  "readEntry: a link through a regular file is reported with no landing, never a ReadFault",
  {
    ignore: WINDOWS,
  },
  async () => {
    // A ReadFault here would tell the user to fix permissions on a file that is fine (cli#704).
    await withProject(async (dir) => {
      await Deno.writeTextFile(join(dir, "README.md"), "x\n");
      await Deno.mkdir(join(dir, "docs"));
      await Deno.symlink("../README.md/x", join(dir, "docs/constitution.md"));
      assertEquals(await new DenoFsReader().readEntry(dir, "docs/constitution.md"), {
        kind: "symlink",
        target: "../README.md/x",
        resolved: null,
      });
    });
  },
);

Deno.test("a dangling ancestor reads as absent, never as a refusal (cli#686)", {
  ignore: !CAN_LINK,
}, async () => {
  await withProject(async (dir) => {
    await makeLink("nope", join(dir, ".claude"), "dir");
    // The very checks each read runs DO refuse this path: the `null`s below
    // are the reader reporting a refusal as absent, not a check that let it by.
    const root = await resolveProjectRoot(dir);
    const abs = join(dir, ".claude/CLAUDE.md");
    await assertRejects(() => assertRemovableInProject(root, abs), UnwalkableRefusal);
    await assertRejects(() => assertInsideProject(root, abs), UnwalkableRefusal);
    const reader = new DenoFsReader();
    assertEquals(await reader.readEntry(dir, ".claude/CLAUDE.md"), null);
    assertEquals(await reader.readText(dir, ".claude/CLAUDE.md"), null);
  });
});

Deno.test("a project directory that does not exist yet holds nothing: null, not a throw", async () => {
  await withProject(async (dir) => {
    const r = new DenoFsReader();
    const ahead = join(dir, "not-yet");
    assertEquals(await r.readEntry(ahead, "AGENTS.md"), null);
    assertEquals(await r.readText(ahead, "AGENTS.md"), null);
  });
});

Deno.test({
  name: "a file that is there and cannot be read throws, never reads as absent",
  ignore: WINDOWS, // POSIX modes: Windows has no 0o000 to read through.
}, async () => {
  await withProject(async (dir) => {
    await Deno.writeTextFile(join(dir, "AGENTS.md"), "# A\n");
    await Deno.chmod(join(dir, "AGENTS.md"), 0o000);
    try {
      const r = new DenoFsReader();
      const readable = await Deno.readFile(join(dir, "AGENTS.md")).then(() => true, () => false);
      if (readable) return; // root reads through any mode: nothing to observe.
      // A `ReadFault` (cli#704): the one throw a caller may call "cannot be read".
      const fault = await assertRejects(() => r.readEntry(dir, "AGENTS.md"), ReadFault);
      assertInstanceOf(fault.cause, Deno.errors.PermissionDenied);
      await assertRejects(() => r.readText(dir, "AGENTS.md"), Deno.errors.PermissionDenied);
    } finally {
      await Deno.chmod(join(dir, "AGENTS.md"), 0o644);
    }
  });
});
