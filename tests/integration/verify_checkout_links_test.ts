import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { CHECKOUT_REASON } from "../../src/domain/checkout_trust.ts";
import { REASON } from "../../src/domain/script_trust.ts";
import { check, onBase, reasons, setUp, startSession } from "./verify_checkout_fixture.ts";
import { write } from "./verify_scripts_fixture.ts";

/**
 * Links among the checked files, as the disk resolves them: the base's own link holds only when it
 * leads to a file the check compared, or into a root it walks whole. POSIX only: creating a link
 * on Windows needs a privilege CI does not have.
 */

const POSIX = Deno.build.os !== "windows";
const L = ".claude/CLAUDE.md";

/** A base that commits each link of `links` (path to target), with the checkout at its tip. */
async function withLinks(links: Record<string, string>, files: Record<string, string> = {}) {
  const { root, head } = await setUp();
  await onBase(root, async () => {
    await write(root, files);
    for (const [path, target] of Object.entries(links)) {
      await Deno.symlink(target, join(root, path));
    }
  });
  return { root, head };
}

Deno.test({
  name: "the base's link to a checked file holds; the same link pointed elsewhere fails",
  ignore: !POSIX,
  fn: async () => {
    const { root, head } = await withLinks({ [L]: "../AGENTS.md" });
    assertEquals((await check(root, head)).kind, "trusted");
    await Deno.remove(join(root, L));
    await Deno.symlink("../README.md", join(root, L));
    assertEquals(reasons(await check(root, head)), [{ path: L, reason: REASON.differs }]);
  },
});

Deno.test({
  name: "the base's link into a subfolder no root walks fails",
  ignore: !POSIX,
  fn: async () => {
    const plan = ".specnaut/specs/001-x/plan.md";
    const { root, head } = await withLinks({ [L]: `../${plan}` }, { [plan]: "# plan\n" });
    assertEquals(reasons(await check(root, head)), [{
      path: L,
      reason: CHECKOUT_REASON.linkLeaves,
    }]);
  },
});

Deno.test({
  name: "the base's link out of the project fails",
  ignore: !POSIX,
  fn: async () => {
    const { root, head } = await withLinks({ [L]: "../../outside.md" });
    await Deno.writeTextFile(join(root, "..", "outside.md"), "rules\n");
    await startSession(root); // once the link leads somewhere, as the check then finds it
    assertEquals(reasons(await check(root, head)), [{
      path: L,
      reason: CHECKOUT_REASON.linkLeaves,
    }]);
  },
});

Deno.test({
  name: "a deep root that is itself a link on the base is judged as that link",
  ignore: !POSIX,
  fn: async () => {
    const { root, head } = await withLinks({ ".agents": ".claude" });
    assertEquals((await check(root, head)).kind, "trusted");
    const other = await withLinks({ ".agents": ".specnaut/specs" }, {
      ".specnaut/specs/x.md": "x\n",
    });
    assertEquals(reasons(await check(other.root, other.head)), [
      { path: ".agents", reason: CHECKOUT_REASON.linkLeaves },
    ]);
  },
});
