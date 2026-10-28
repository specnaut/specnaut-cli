import { assert, assertEquals } from "@std/assert";
import { HARNESSES } from "../../../src/cli/harnesses.ts";
import { everyBundleOption } from "../../../src/application/bundle_options.ts";
import { CORE_BUNDLE } from "../../../src/templates_bundle.ts";
import { orphanScope, SHARED_ROOTS, SPECNAUT_FILES } from "../../../src/domain/orphan_scope.ts";

/**
 * `Harness.managedRoots` and `SHARED_ROOTS` bound what `upgrade` may delete
 * (cli#665), so they must agree with what the adapters write — both ways, read
 * off `mapBundle` over the whole install parameter space rather than a list.
 *
 * Too narrow, and an orphan Specnaut wrote is left behind as foreign. Too wide,
 * and a lock entry reaches a file the project wrote: `.claude/settings.local.json`,
 * `.cursor/mcp.json`, a spec under `.specnaut/specs/`.
 *
 * Files directly in a harness's own folder (`.claude/loop.md`, `.codex/config.toml`)
 * are deliberately under no root: that folder also holds the project's own
 * settings, so such a file retired upstream is reported and left rather than
 * deleted. Files directly in `.specnaut/` are in scope only by name
 * (`SPECNAUT_FILES`), for the same reason.
 */

function written(harness: (typeof HARNESSES)[number]): string[] {
  const dests = new Set<string>();
  for (const opts of everyBundleOption()) {
    for (const dest of Object.keys(harness.mapBundle(CORE_BUNDLE, opts))) dests.add(dest);
  }
  return [...dests];
}

/** The deepest folder every one of `dests` sits in. */
function commonFolder(dests: string[]): string {
  const split = dests.map((d) => d.split("/").slice(0, -1));
  const out: string[] = [];
  for (let i = 0; split.every((s) => i < s.length && s[i] === split[0][i]); i++) {
    out.push(split[0][i]);
  }
  return out.map((s) => `${s}/`).join("");
}

for (const harness of HARNESSES) {
  const dests = written(harness);
  const roots = [...SHARED_ROOTS, ...(harness.managedRoots ?? [])];

  Deno.test(`${harness.key}: every file it writes below its own folders sits under a root`, () => {
    const nested = dests.filter((d) => d.split("/").length >= 3);
    assert(nested.length > 20, `only ${nested.length} nested dests read for ${harness.key}`);
    const stray = nested.filter((d) => !roots.some((r) => d.startsWith(r)));
    assertEquals(stray, [], `written outside ${harness.key}'s roots`);
  });

  Deno.test(`${harness.key}: every root is written to, and is no wider than what it writes`, () => {
    assert((harness.managedRoots ?? []).length > 0, `${harness.key} declares no managed roots`);
    for (const root of roots) {
      assert(root.endsWith("/") && !root.startsWith("/"), `malformed root ${root}`);
      const under = dests.filter((d) => d.startsWith(root));
      assert(under.length > 0, `${root} is declared but nothing is written there`);
      // Widening `.agents/skills/` to `.agents/` leaves every file still under
      // one deeper folder: the root would claim a sibling Specnaut never writes.
      assertEquals(commonFolder(under), root, `${root} is wider than what is written under it`);
    }
    assertEquals(roots.includes(".github/"), false, "a project's own workflows live in .github/");
  });

  Deno.test(`${harness.key}: a file beside a root, in the folder above it, is the project's`, () => {
    // What the minimality check above cannot see: `.cursor/rules/` widened to
    // `.cursor/` is still exactly as wide as what is written under it, and then
    // reaches `.cursor/mcp.json`. Probe the folder above every root instead.
    // And the top folder it sits in, which a root widened to `.codex/` claims
    // while the folder above it is the project root itself.
    for (const root of roots) {
      const parts = root.split("/").slice(0, -1);
      for (const folder of new Set([parts.slice(0, -1).join("/"), parts[0]])) {
        if (folder === "") continue;
        const beside = `${folder}/zz-project-file`;
        assertEquals(
          orphanScope(beside, harness.managedRoots),
          "outside-managed-roots",
          `${beside} is in scope — ${root} or a sibling claims ${folder}/`,
        );
      }
    }
  });

  Deno.test(`${harness.key}: every file it writes directly in .specnaut/ is listed by name`, () => {
    const direct = dests.filter((d) => d.startsWith(".specnaut/") && d.split("/").length === 2);
    assert(direct.length > 0, "no file read directly under .specnaut/");
    const unlisted = direct.filter((d) => !SPECNAUT_FILES.includes(d));
    assertEquals(unlisted, [], "a release could not retire these: add them to SPECNAUT_FILES");
  });
}
