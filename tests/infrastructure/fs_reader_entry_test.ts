import { assert, assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { DenoFsReader } from "../../src/infrastructure/fs_reader.ts";
import { ReadFault } from "../../src/application/read_fault.ts";
import { ContainmentRefusal } from "../../src/infrastructure/fs_refusals.ts";
import { WINDOWS } from "../helpers/link_text.ts";

/** `readEntry` reports what is at a path itself — a link as a link (cli#680). */

async function withProject(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
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
  ignore: WINDOWS,
}, async () => {
  await withProject(async (dir) => {
    await Deno.writeTextFile(join(dir, "AGENTS.md"), "# A\n");
    await Deno.mkdir(join(dir, ".claude"));
    await Deno.symlink("../AGENTS.md", join(dir, ".claude/CLAUDE.md"));
    assertEquals(await new DenoFsReader().readEntry(dir, ".claude/CLAUDE.md"), {
      kind: "symlink",
      target: "../AGENTS.md",
      resolved: "AGENTS.md",
    });
  });
});

Deno.test("readEntry: a link out of the project is reported, never refused or read", {
  ignore: WINDOWS,
}, async () => {
  // `readText` refuses this path; `upgrade` still has to know what is there to
  // decide to replace it.
  await withProject(async (dir) => {
    const outside = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(outside, "secret.md"), "secret\n");
      await Deno.mkdir(join(dir, ".claude"));
      await Deno.symlink(join(outside, "secret.md"), join(dir, ".claude/CLAUDE.md"));
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
  { ignore: WINDOWS },
  async () => {
    await withProject(async (dir) => {
      await Deno.symlink("b.md", join(dir, "a.md"));
      await Deno.symlink("a.md", join(dir, "b.md"));
      assertEquals(await new DenoFsReader().readEntry(dir, "a.md"), {
        kind: "symlink",
        target: "b.md",
        resolved: null,
      });
    });
  },
);

Deno.test("readEntry: a link through a missing directory is reported with no landing (cli#686)", {
  ignore: WINDOWS,
}, async () => {
  // The walk refuses to guess where `nope/AGENTS.md` lands; `readEntry` must
  // still report the link, not abort `upgrade` or `diff` over it.
  await withProject(async (dir) => {
    await Deno.mkdir(join(dir, ".claude"));
    await Deno.symlink("nope/AGENTS.md", join(dir, ".claude/CLAUDE.md"));
    assertEquals(await new DenoFsReader().readEntry(dir, ".claude/CLAUDE.md"), {
      kind: "symlink",
      target: "nope/AGENTS.md",
      resolved: null,
    });
  });
});

Deno.test("a dangling ancestor reads as absent, never as a refusal (cli#686)", {
  ignore: WINDOWS,
}, async () => {
  await withProject(async (dir) => {
    await Deno.symlink("nope", join(dir, ".claude"));
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
  ignore: WINDOWS,
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
