// Every git call given an `--objects <dir>` folder turns its commit graphs and multi-pack indexes
// off, so git reads the folder's objects and nothing that could stand in for them. The setting is
// asserted on each script that takes the folder; the refusals of the folder itself are in
// explicit_head_alternates_test.ts.

import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import {
  BOUNDARIES_CONFIG_PATH,
  SIZE_LIMITS_CONFIG_PATH,
} from "../../src/domain/constitution_paths.ts";
import { gitRead } from "../templates/git_read_fixture.ts";
import { scope } from "../templates/collect_audit_scope_fixture.ts";
import {
  assertNoGraphs,
  bashScript,
  gitRecorder,
  gitRecorderUnsure,
  headRepo,
} from "./explicit_head_fixture.ts";
import { FILE, lines, SCRIPT as SIZE_RATCHET } from "./size_ratchet_fixture.ts";

const BOUNDARY_CHECK = fromFileUrl(
  new URL("../../templates/core/specnaut/scripts/bash/boundary-check.sh", import.meta.url),
);

/** A head the size ratchet, the boundary check and the audit scope all have work on. */
const allScripts = () =>
  headRepo(
    {
      [SIZE_LIMITS_CONFIG_PATH]: FILE(20, 25),
      [BOUNDARIES_CONFIG_PATH]: "domain:\n  - 'src'\nforbid:\n  - '^import .* from \"web\"'\n",
      "src/a.ts": "a\n",
    },
    { "src/a.ts": lines(10), "src/head_only.ts": "h\n" },
  );

const sweep = { ignore: gitRecorderUnsure };

Deno.test({
  ...sweep,
  name: "explicit head: size-ratchet reads the objects folder with its graphs off",
  fn: async () => {
    const repo = await allScripts();
    const rec = await gitRecorder();
    const args = ["--since", repo.base, "--head", repo.head, "--objects", repo.objects, "--report"];
    const r = await bashScript(SIZE_RATCHET, args, repo.root, rec.env);
    assertEquals(r.code, 0, r.stdout + r.stderr);
    assertStringIncludes(r.stdout, "src/a.ts: 1 → 10");
    assertNoGraphs(await rec.calls(), "size-ratchet");
  },
});

Deno.test({
  ...sweep,
  name: "explicit head: boundary-check reads the objects folder with its graphs off",
  fn: async () => {
    const repo = await allScripts();
    const rec = await gitRecorder();
    const r = await bashScript(
      BOUNDARY_CHECK,
      ["--head", repo.head, "--objects", repo.objects],
      repo.root,
      rec.env,
    );
    assertEquals(r.code, 0, r.stdout + r.stderr);
    assertStringIncludes(r.stdout, "2 file(s) under domain: clean");
    assertNoGraphs(await rec.calls(), "boundary-check");
  },
});

Deno.test({
  ...sweep,
  name: "explicit head: git-read reads the objects folder with its graphs off, in every form",
  fn: async () => {
    const repo = await allScripts();
    const rec = await gitRecorder();
    const head = ["--head", repo.head, "--objects", repo.objects];
    for (
      const form of [
        ["files", "src"],
        ["names", repo.base, repo.head],
        ["log", `${repo.base}..${repo.head}`],
        ["show", repo.head, "--stat"],
        ["base", "main"],
        ["grep", "a", repo.head],
      ]
    ) {
      const r = await gitRead([...head, ...form], repo.root, rec.env);
      assertEquals(r.code, 0, form.join(" ") + r.stderr);
    }
    assertNoGraphs(await rec.calls(), "git-read");
  },
});

Deno.test({
  ...sweep,
  name: "explicit head: collect-audit-scope reads the objects folder with its graphs off",
  fn: async () => {
    const repo = await allScripts();
    const rec = await gitRecorder();
    const r = await scope(
      repo.root,
      ["--last", "1", "--head", repo.head, "--objects", repo.objects],
      rec.env,
    );
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "src/head_only.ts\n");
    assertNoGraphs(await rec.calls(), "collect-audit-scope");
  },
});
