import { assert, assertEquals } from "@std/assert";
import { HARNESSES } from "../../../src/cli/harnesses.ts";
import { harnessCommands } from "../../../src/infrastructure/harness/harness_commands.ts";
import type { KnownHarness } from "../../../src/domain/installed_lock.ts";
import { CORE_BUNDLE } from "../../../src/templates_bundle.ts";
import { type CoreEntry, skillDocName } from "../../../src/domain/core_bundle.ts";
import { isSkillDoc } from "../../../src/infrastructure/harness/skill_folder.ts";
import type { Harness } from "../../../src/application/ports.ts";

/**
 * `init`'s "Next steps" told every user to type the Claude commands.
 *
 * On the five harnesses that namespace their skills the board is
 * `/specnaut-board`, so `/board add` — the headline command of 4.0.0 — was a
 * no-op in the one place a first-time user reads. Windsurf was wrong twice
 * over: its documents are flat sibling workflows.
 *
 * These do not assert a table's contents. They assert the command against the
 * destination each harness actually emits, so a harness that changes its
 * layout takes this file red instead of silently making `init` lie.
 *
 * **Owner-generic, deliberately.** An earlier version pinned the literals
 * `/specnaut plan` and `/specnaut-plan`. Those pass for `specnaut` and say
 * nothing about any other skill — which is exactly how the command table came
 * to hold a rule with no owner variable, emitting a command for a file that
 * does not exist the moment a second skill owned documents. Nothing here names
 * `specnaut`.
 */

const OPTS = { backlogBackend: "local", versionScheme: "semver", specBackend: "local" } as const;

/** The one destination this entry produces for this harness, or null if filtered out. */
function destOf(h: Harness, e: CoreEntry): string | null {
  const statics = new Set(Object.keys(h.mapBundle([], OPTS)));
  const own = Object.keys(h.mapBundle([e], OPTS)).filter((d) => !statics.has(d));
  return own[0] ?? null;
}

const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/**
 * A command must locate its destination. `/a b` means "skill `a`, document `b`"
 * and the destination is nested; `/a-b` means the whole token is the filename
 * stem and the destination is flat. Both are checked against the real path.
 */
function assertCommandLocates(harnessKey: string, command: string, dest: string): void {
  assert(command.startsWith("/"), `${harnessKey}: ${command} does not start with a slash`);
  const [token, arg] = command.slice(1).split(" ");

  if (arg === undefined) {
    assert(
      basename(dest).startsWith(`${token}.`),
      `${harnessKey}: flat command ${command} does not name the file it maps to (${dest})`,
    );
    return;
  }
  assert(
    dest.split("/").includes(token),
    `${harnessKey}: nested command ${command} names a skill folder absent from ${dest}`,
  );
  assertEquals(
    basename(dest),
    `${arg}.md`,
    `${harnessKey}: nested command ${command} names a document absent from ${dest}`,
  );
}

Deno.test("every skill document's command locates the file the harness emits", () => {
  let checked = 0;
  for (const h of HARNESSES) {
    const cmd = harnessCommands(h.key as KnownHarness);
    if (!cmd.invocable) continue;
    for (const e of CORE_BUNDLE) {
      if (!isSkillDoc(e.category)) continue;
      const dest = destOf(h, e);
      if (dest === null) continue; // filtered out by the render options
      assertCommandLocates(h.key, cmd.skillDoc(e.name, skillDocName(e)), dest);
      checked++;
    }
  }
  // Non-vacuity: 6 invocable harnesses × 24 sub-documents (21 phases + 3
  // backlog docs). A derivation that silently returned nothing would otherwise
  // report green having asserted nothing at all.
  assertEquals(checked, 144, "the sweep did not cover every harness × sub-document");
});

Deno.test("every top-level skill's command locates the folder the harness emits", () => {
  let checked = 0;
  for (const h of HARNESSES) {
    const cmd = harnessCommands(h.key as KnownHarness);
    if (!cmd.invocable) continue;
    for (const e of CORE_BUNDLE) {
      if (e.category !== "skill" && e.category !== "backlog-skill") continue;
      const dest = destOf(h, e);
      if (dest === null) continue;
      const token = cmd.skill(e.name).slice(1);
      assert(
        dest.split("/").includes(token) || basename(dest).startsWith(`${token}.`),
        `${h.key}: ${cmd.skill(e.name)} locates neither a folder nor a file in ${dest}`,
      );
      checked++;
    }
  }
  assert(checked > 0, "no top-level skill was checked");
});

Deno.test("a harness with no slash surface emits no invocable skill command", () => {
  for (const h of HARNESSES) {
    const cmd = harnessCommands(h.key as KnownHarness);
    if (cmd.invocable) continue;
    // The claim is "there is nothing to type", and the type enforces it: there
    // is no `skill` or `skillDoc` to call. Assert the claim is true of the
    // harness too — it must not be emitting a nested skill folder a user could
    // reach by name.
    const dests = Object.keys(h.mapBundle(CORE_BUNDLE, OPTS));
    assert(
      !dests.some((d) => /\/skills\/[^/]+\/SKILL\.md$/.test(d)),
      `${h.key} declares no command surface but emits nested skill folders`,
    );
  }
});

Deno.test("no harness advertises the pre-4.0.0 name", () => {
  for (const h of HARNESSES) {
    const cmd = harnessCommands(h.key as KnownHarness);
    if (!cmd.invocable) continue;
    assert(
      !cmd.skill("board").includes("backlog"),
      `${h.key} still advertises ${cmd.skill("board")}`,
    );
  }
});
