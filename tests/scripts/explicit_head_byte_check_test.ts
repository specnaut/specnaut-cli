// The control-byte check on an objects folder's `info/alternates` decides from what `tr` printed:
// a `tr` that fails prints nothing, which reads as "no control byte". A failure is a refusal.
// Driven through git-read.sh, as explicit_head_alternates_test.ts drives the other refusals, and
// through the library alone, sourced by a shell that never set pipefail. The check is a helper of
// its own, which keeps every function of the library within the 20-line function target.

import { assertEquals, assertStringIncludes } from "@std/assert";
import { DELIMITER, fromFileUrl, join } from "@std/path";
import { run } from "../templates/child_fixture.ts";
import { gitRead } from "../templates/git_read_fixture.ts";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";
import { headRepo } from "./explicit_head_fixture.ts";

const LIBRARY_URL = new URL(
  "../../templates/core/specnaut/scripts/bash/_explicit_head.sh",
  import.meta.url,
);
const LIBRARY = bashPath(fromFileUrl(LIBRARY_URL));

/**
 * A `tr` placed first on the PATH that fails, printing nothing, when it is asked to keep a byte
 * class (`-dc`) and TR_FAILS is set, and otherwise runs the real one. Git for Windows' bash puts
 * its own folders first, so the case skips Windows.
 */
async function failingTr(): Promise<Record<string, string>> {
  const dir = await Deno.makeTempDir({ prefix: "explicit-head-tr-" });
  const shim = join(dir, "tr");
  await Deno.writeTextFile(
    shim,
    [
      "#!/usr/bin/env bash",
      'if [ -n "${TR_FAILS:-}" ] && [ "$1" = -dc ]; then exit 1; fi',
      'PATH="${PATH#*:}"',
      'exec tr "$@"',
      "",
    ].join("\n"),
  );
  await Deno.chmod(shim, 0o755);
  const key = Object.keys(Deno.env.toObject()).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  made.push(dir);
  return { [key]: `${dir}${DELIMITER}${Deno.env.get("PATH") ?? ""}` };
}

/** The folders a case made: the shim's, the project's and the one holding the head. */
const made: string[] = [];

async function fixture() {
  const repo = await headRepo({ "src/a.ts": "a\n" }, { "src/head_only.ts": "h\n" });
  made.push(repo.root, join(repo.objects, "..", ".."));
  return { repo, path: await failingTr() };
}

/** `fn`, then every folder it made removed, whatever it threw. */
const scoped = (fn: () => Promise<void>) => async () => {
  try {
    await fn();
  } finally {
    for (const dir of made.splice(0)) await Deno.remove(dir, { recursive: true });
  }
};

Deno.test({
  name: "explicit head: a control-byte check that cannot run refuses the folder",
  ignore: Deno.build.os === "windows",
  fn: scoped(async () => {
    const { repo, path } = await fixture();
    const args = ["--head", repo.head, "--objects", repo.objects, "files"];

    const control = await gitRead(args, repo.root, path);
    assertEquals(control.code, 0, `the control: the shim alone refuses nothing: ${control.stderr}`);
    assertStringIncludes(control.stdout, "src/head_only.ts");

    const r = await gitRead(args, repo.root, { ...path, TR_FAILS: "1" });
    assertEquals(r.code, 2, r.stdout + r.stderr);
    assertStringIncludes(
      r.stderr,
      `--head: an objects folder borrowing from more than this repository: ${repo.objects}`,
    );
  }),
});

Deno.test({
  name: "explicit head: the check refuses on a failed tr in a shell without pipefail too",
  ignore: Deno.build.os === "windows",
  fn: scoped(async () => {
    const { repo, path } = await fixture();
    const script =
      '. "$1" || exit 70; explicit_head_take "$2" "$3" git; echo "$?: $EXPLICIT_REFUSAL"';
    const take = (env: Record<string, string>) =>
      run("bash", ["-c", script, "_", LIBRARY, repo.head, repo.objects], repo.root, env);

    const control = await take(path);
    assertEquals(control.stdout.trim(), "0:", control.stderr);
    const r = await take({ ...path, TR_FAILS: "1" });
    assertStringIncludes(r.stdout, "2: an objects folder borrowing from more than this repository");
  }),
});

/** Each `name() {` … `}` of a bash file, as its name and its length in lines, both braces counted. */
function functionLengths(text: string): [string, number][] {
  const lines = text.split("\n");
  const found: [string, number][] = [];
  lines.forEach((line, start) => {
    const name = /^([A-Za-z_][A-Za-z0-9_]*)\(\) \{$/.exec(line)?.[1];
    if (!name) return;
    const end = lines.findIndex((l, i) => i > start && l === "}");
    found.push([name, end - start + 1]);
  });
  return found;
}

Deno.test("explicit head: every function of the library is 20 lines or fewer", async () => {
  const lengths = functionLengths(await Deno.readTextFile(fromFileUrl(LIBRARY_URL)));
  assertEquals(lengths.some(([name]) => name === "_explicit_head_own_alternates"), true);
  assertEquals(lengths.filter(([, n]) => n > 20), []);
});
