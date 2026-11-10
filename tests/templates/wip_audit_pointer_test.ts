import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { CORE_BUNDLE, HARNESS_STATIC } from "../../src/templates_bundle.ts";
import { HARNESSES } from "../../src/cli/harnesses.ts";
import { everyBundleOption } from "../../src/application/bundle_options.ts";
import { renderSpecBackend } from "../../src/domain/conditional_render.ts";
import { sandbox } from "../scripts/git_sandbox.ts";
import { flat, phase } from "./task_docs.ts";

/**
 * cli#742 — an item with no creation time (`view.sh` printed `—`) is passed to
 * wip-audit.sh as `<n>` alone. That rule has one home, the script's header; every
 * path an agent can take to `12@—` must lead it there without restating it. The
 * usage line reaches every render, including a Cloud backlog with local specs,
 * whose `plan` renders no `spec-backend=cloud` block; implement's Cloud block is
 * told before its call, because that block stops on any non-zero exit.
 */

const SCRIPT_PATH = fromFileUrl(
  new URL("../../templates/core/specnaut/scripts/bash/wip-audit.sh", import.meta.url),
);
const POINTER =
  "an item with no creation time: see the header of .specnaut/scripts/bash/wip-audit.sh";
const USAGE = "usage: wip-audit.sh [--limit <N>] <num>[@<epoch>]...";
const RULE = "is passed as `<n>` alone, and the caller says the date filter was off for it.";
const SPELLINGS = ["date filter was off", "`<n>` alone", "`<num>` alone"];

Deno.test("12@— is still refused, and the refusal points at the header without echoing it", async () => {
  const sb = await sandbox();
  try {
    const r = await sb.script("wip-audit.sh", "12@—");
    assertEquals(r.code, 2, r.stderr);
    assertEquals(r.stdout, "");
    assertEquals(r.stderr.replace(/\r\n/g, "\n"), `${USAGE}\n${POINTER}\n`);
    // ASCII only (a legacy Windows code page mangles anything else), and a fixed
    // literal: the rejected argument is never printed back.
    assert(/^[\x20-\x7e\n]*$/.test(r.stderr), "a non-ASCII byte in the usage output");
    assert(!r.stderr.includes("12@"), "the rejected argument was echoed");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("the header is still the rule's one home", () => {
  const header = Deno.readTextFileSync(SCRIPT_PATH).replace(/\r\n/g, "\n");
  assertStringIncludes(flat(header.replace(/^# ?/gm, "")), RULE);
  for (const e of CORE_BUNDLE) {
    if (e.suffix === "scripts/bash/wip-audit.sh") continue;
    for (const s of SPELLINGS) {
      assert(!e.content.includes(s), `${e.category}/${e.name}/${e.suffix} restates "${s}"`);
    }
  }
  for (const [harness, files] of Object.entries(HARNESS_STATIC)) {
    for (const [path, f] of Object.entries(files)) {
      for (const s of SPELLINGS) {
        assert(!(f.content ?? "").includes(s), `${harness}:${path} restates "${s}"`);
      }
    }
  }
});

Deno.test("implement on Cloud specs is pointed at the header before it calls the script", () => {
  const cloud = renderSpecBackend(phase("implement").content, "cloud");
  const pointer = cloud.indexOf("the header of `wip-audit.sh` says what to pass");
  const call = cloud.indexOf("`bash .specnaut/scripts/bash/wip-audit.sh <task>@<epoch>`");
  assert(pointer >= 0, "implement's Cloud block lost the pointer");
  assert(call > pointer, "the pointer must come before the call, which stops on a non-zero exit");
  assertStringIncludes(cloud, "If `view.sh` printed `—` for it, the header of `wip-audit.sh`");
});

Deno.test("every harness and option set ships the pointer, Cloud backlog with local specs included", () => {
  let cloudBacklogLocalSpecs = 0;
  for (const h of HARNESSES) {
    for (const opts of everyBundleOption()) {
      const tag = `${h.key}/${JSON.stringify(opts)}`;
      const script = h.mapBundle(CORE_BUNDLE, opts)[".specnaut/scripts/bash/wip-audit.sh"];
      assert(script, `${tag}: wip-audit.sh missing`);
      assert((script.content ?? "").includes(POINTER), `${tag}: no pointer in the usage output`);
      if (opts.backlogBackend === "cloud" && opts.specBackend === "local") {
        cloudBacklogLocalSpecs++;
      }
    }
  }
  assert(cloudBacklogLocalSpecs > 0, "no Cloud-backlog, local-spec combination was checked");
});
