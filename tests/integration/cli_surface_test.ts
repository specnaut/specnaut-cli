import { assertEquals, assertStringIncludes } from "@std/assert";
import { runSpecnaut } from "../helpers/run_specnaut.ts";

/** The top-level CLI surface — version, help, an unknown command — black-box. */

Deno.test("specnaut --version prints semver line", async () => {
  const { code, stdout } = await runSpecnaut(["--version"]);
  assertEquals(code, 0);
  assertStringIncludes(stdout, "specnaut ");
  assertStringIncludes(stdout, "templates ");
});

Deno.test("specnaut -v matches --version", async () => {
  const long = await runSpecnaut(["--version"]);
  const short = await runSpecnaut(["-v"]);
  assertEquals(short.code, 0);
  assertEquals(short.stdout, long.stdout);
});

Deno.test("specnaut --help prints usage", async () => {
  const { code, stdout } = await runSpecnaut(["--help"]);
  assertEquals(code, 0);
  assertStringIncludes(stdout, "Usage:");
  assertStringIncludes(stdout, "specnaut init");
});

Deno.test("specnaut -h matches --help", async () => {
  const long = await runSpecnaut(["--help"]);
  const short = await runSpecnaut(["-h"]);
  assertEquals(short.code, 0);
  assertEquals(short.stdout, long.stdout);
});

Deno.test("specnaut --help advertises -v and -h shortcuts", async () => {
  const { stdout } = await runSpecnaut(["--help"]);
  assertStringIncludes(stdout, "--version, -v");
  assertStringIncludes(stdout, "--help, -h");
});

Deno.test("specnaut --help tagline does not mention spec-kit", async () => {
  const { stdout } = await runSpecnaut(["--help"]);
  assertStringIncludes(stdout, "AI project scaffolding CLI");
  assertEquals(
    stdout.toLowerCase().includes("spec-kit"),
    false,
    "help tagline must not mention spec-kit (lineage belongs in README/AGENTS.md)",
  );
});

Deno.test("specnaut bogus returns exit code 2", async () => {
  const { code } = await runSpecnaut(["bogus"]);
  assertEquals(code, 2);
});
