import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { resolveProjectRoot } from "../../src/infrastructure/fs_containment.ts";

/**
 * `resolveProjectRoot` compares the project with the home directory resolved,
 * and falls back on the lexical value only when the home directory names no
 * directory this process can reach (cli#690). A home that cannot be resolved
 * for any other reason is not guessed at.
 */

const WINDOWS = Deno.build.os === "windows";

/** Runs `fn` with `HOME` set to `home`, restored afterwards, in a fresh temp dir. */
async function withHome(
  home: (dir: string) => string,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "home-" });
  const saved = Deno.env.get("HOME");
  try {
    Deno.env.set("HOME", home(dir));
    await fn(dir);
  } finally {
    if (saved === undefined) Deno.env.delete("HOME");
    else Deno.env.set("HOME", saved);
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("a home directory that does not exist is no reason to refuse a project", async () => {
  await withHome((dir) => join(dir, "gone"), async (dir) => {
    await Deno.mkdir(join(dir, "proj"));
    assertEquals(
      await resolveProjectRoot(join(dir, "proj")),
      await Deno.realPath(join(dir, "proj")),
    );
  });
});

Deno.test({
  name: "a home directory behind a folder this process cannot search is no reason to refuse",
  ignore: WINDOWS, // POSIX modes: Windows has no 0o000.
  fn: () =>
    withHome((dir) => join(dir, "locked", "home"), async (dir) => {
      // The container case: HOME left at a directory the running user cannot enter.
      await Deno.mkdir(join(dir, "locked", "home"), { recursive: true });
      await Deno.mkdir(join(dir, "proj"));
      await Deno.chmod(join(dir, "locked"), 0o000);
      try {
        const searchable = await Deno.realPath(join(dir, "locked", "home"))
          .then(() => true, () => false);
        if (searchable) return; // root searches through any mode: nothing to observe.
        assertEquals(
          await resolveProjectRoot(join(dir, "proj")),
          await Deno.realPath(join(dir, "proj")),
        );
      } finally {
        await Deno.chmod(join(dir, "locked"), 0o755);
      }
    }),
});

Deno.test("the home directory reached by its real path is still refused", async () => {
  await withHome((dir) => join(dir, "home"), async (dir) => {
    await Deno.mkdir(join(dir, "home"));
    await assertRejects(() => resolveProjectRoot(join(dir, "home")), Error, "home directory");
  });
});
