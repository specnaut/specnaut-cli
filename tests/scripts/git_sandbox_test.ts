import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { run } from "./git_sandbox.ts";

/**
 * cli#711 — the merge-script sandbox is hermetic: what the developer's own git
 * setup holds (a global config, a `GIT_*` variable, a locale) never reaches the
 * scripts under test, so a green run means the same thing on every machine.
 */

const LEAKS: Record<string, string> = {
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "leak.env",
  GIT_CONFIG_VALUE_0: "yes",
  LC_ALL: "fr_FR.UTF-8",
};

Deno.test("a child of run() sees no global git config, no GIT_* variable, and the C locale", async () => {
  const home = await Deno.makeTempDir({ prefix: "specnaut-leaky-home-" });
  const saved = Object.fromEntries(
    [...Object.keys(LEAKS), "HOME", "GIT_CONFIG_GLOBAL"].map((k) => [k, Deno.env.get(k)]),
  );
  try {
    await Deno.writeTextFile(join(home, ".gitconfig"), "[leak]\n\thome = yes\n");
    Deno.env.set("HOME", home);
    Deno.env.delete("GIT_CONFIG_GLOBAL");
    for (const [k, v] of Object.entries(LEAKS)) Deno.env.set(k, v);
    for (const key of ["leak.env", "leak.home"]) {
      const r = await run("git", ["config", "--get", key], home);
      // 1 is git's "key not set"; any other code is a failure an empty stdout would hide.
      assertEquals(r.code, 1, `${key}: git config exited ${r.code}: ${r.stderr}`);
      assertEquals(r.stdout.trim(), "", `${key} reached the sandbox`);
    }
    const env = await run("bash", ["-c", 'echo "$LC_ALL|${GIT_CONFIG_COUNT:-}|$HOME"'], home);
    const [lc, count, childHome] = env.stdout.trim().split("|");
    assertEquals([lc, count], ["C", ""]);
    assertEquals(childHome === home, false, "the developer's HOME reached the sandbox");
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
    }
    await Deno.remove(home, { recursive: true });
  }
});
