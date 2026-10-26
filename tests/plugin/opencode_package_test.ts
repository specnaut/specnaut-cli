import { assert, assertEquals } from "@std/assert";
import { exists } from "@std/fs/exists";
import { fromFileUrl, join } from "@std/path";
import { opencodePinProblems } from "../../scripts/catalog-refs.ts";

/**
 * OpenCode installs a plugin string with npm's installer. A git specifier needs
 * a `package.json` at the repository root, or the install fails before anything
 * loads: the documented OpenCode line never installed anything until cli#667,
 * because this repository had none.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const pkg = JSON.parse(await Deno.readTextFile(join(ROOT, "package.json"))) as Record<
  string,
  unknown
>;

Deno.test("package.json makes the repository installable as the OpenCode plugin", async () => {
  // The name the documented specifier asks for, and the module OpenCode loads.
  assertEquals(pkg.name, "specnaut");
  assertEquals(pkg.type, "module");
  assertEquals(pkg.main, ".opencode/plugins/specnaut.js");
  assert(await exists(join(ROOT, pkg.main as string)), "main points at nothing");
  // The registrar resolves the skills directory from its own location, so the
  // installed package must carry both, and nothing it does not need.
  assertEquals(pkg.files, [".opencode/plugins/", "plugin/skills/"]);
  const registrar = await Deno.readTextFile(join(ROOT, pkg.main as string));
  assert(
    registrar.includes('"../../plugin/skills"'),
    "the registrar no longer reads plugin/skills",
  );
  assert(await exists(join(ROOT, "plugin/skills/specnaut/SKILL.md")), "no skills to serve");
});

Deno.test("package.json runs nothing at install and pulls in nothing", () => {
  // A git install runs `prepare`; none of these may exist. And no dependency:
  // this is a Deno repository, and npm packages here would change how Deno
  // resolves it.
  for (const key of ["scripts", "dependencies", "devDependencies", "peerDependencies"]) {
    assertEquals(pkg[key], undefined, `package.json declares ${key}`);
  }
  assertEquals(pkg.private, true, "never publishable to the npm registry by accident");
});

Deno.test("the README pins the OpenCode install line to this version", async () => {
  const { version } = JSON.parse(await Deno.readTextFile(join(ROOT, "deno.json"))) as {
    version: string;
  };
  const readme = await Deno.readTextFile(join(ROOT, "README.md"));
  assertEquals(opencodePinProblems(readme, `v${version}`), []);
});
