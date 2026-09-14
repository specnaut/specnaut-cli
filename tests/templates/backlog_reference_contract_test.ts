import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { CORE_BUNDLE, HARNESS_STATIC } from "../../src/templates_bundle.ts";
import { fromFileUrl } from "@std/path";
import { skillDocName } from "../../src/domain/core_bundle.ts";

/**
 * Locks the backlog-reference rule to a single canonical home.
 *
 * The deliverable is explicitly NOT the rule repeated across the fleet: it is
 * one copy plus a reference mechanism. Two channels pick it up — agents through
 * their `skills:` frontmatter, and everything else through a one-line pointer —
 * and neither may restate the rule. The non-duplication test below is what
 * keeps that true past the first release.
 */

const CONTRACT = "backlog-reference-contract";

/**
 * Load-bearing sentences from the contract. Each must appear in exactly ONE
 * bundled entry — the contract itself. A second copy anywhere turns this red.
 */
const LOAD_BEARING = [
  "**Never a number alone** when the title is available.",
  "**Never fabricate a URL.**",
  "Title verbatim.",
  "A degraded reference is still",
];

/** Agents that emit backlog references and pick the contract up via `skills:`. */
const CHANNEL_A = ["product-owner", "developer", "workflow-manager"] as const;

/** Bundled surfaces with no frontmatter preloading — they carry a pointer. */
const CHANNEL_B_CORE: ReadonlyArray<{ category: string; name: string }> = [
  { category: "backlog-skill", name: "board" },
  { category: "backlog-doc", name: "board" },
  { category: "phase", name: "merge" },
  // #560 moved the close and reconcile block out of `merge.md` into this
  // companion, which is where items are actually named now. Both are listed:
  // `merge.md` still specifies the report, and this file does the naming.
  { category: "phase", name: "merge-close" },
  { category: "project-root", name: "root" },
  // `specify` is deliberately absent. Windsurf renders each phase as a Cascade
  // workflow capped at 12 000 characters, and specify.md already sits ~40 chars
  // under it — any pointer pushes it over. Its backlog mentions are `linked_issue`
  // plumbing (storing the number in feature.json) rather than user-facing
  // references, and the agents that do the talking are wired through Channel A,
  // so the rule still reaches the output. Revisit if specify.md is ever trimmed.
];

/** Harness rules files, which ship through HARNESS_STATIC rather than the core bundle. */
const CHANNEL_B_STATIC: ReadonlyArray<{ harness: string; dest: string }> = [
  { harness: "claude", dest: ".claude/CLAUDE.md" },
  { harness: "codex", dest: ".codex/AGENTS.md" },
  { harness: "cursor", dest: ".cursor/rules/specify-rules.mdc" },
];

function entry(category: string, name: string) {
  // `phase` changed shape in spec 033: `name` is now the owning skill and the
  // document is the suffix, so a phase is addressed by its document name.
  // `backlog-doc` did NOT change — its rows above address it by owner (`board`),
  // which resolves to that skill's first doc, and that is the behaviour they
  // have always had. Applying the phase rule to both would silently stop
  // matching `board`.
  return CORE_BUNDLE.find((e) =>
    e.category === category &&
    (category === "phase" ? skillDocName(e) === name : e.name === name)
  );
}

Deno.test("the contract ships as a preloaded, non-invocable skill", () => {
  const e = entry("skill", CONTRACT);
  assert(e, `${CONTRACT} missing from CORE_BUNDLE`);
  assert(/^user-invocable:\s*false\s*$/m.test(e.content));
  assertStringIncludes(e.content, "Preloaded, not user-invocable.");
});

Deno.test("the rule's substance lives in exactly one bundled entry", () => {
  for (const sentence of LOAD_BEARING) {
    const core = CORE_BUNDLE.filter((e) => e.content.includes(sentence));
    const staticHits = Object.entries(HARNESS_STATIC).flatMap(([h, files]) =>
      Object.entries(files)
        .filter(([, f]) => f.content.includes(sentence))
        .map(([dest]) => `${h}:${dest}`)
    );
    const where = [...core.map((e) => `${e.category}/${e.name}`), ...staticHits];
    assertEquals(
      where.length,
      1,
      `"${sentence}" must appear once (the contract), found in: ${where.join(", ") || "nowhere"}`,
    );
    assertEquals(where[0], `skill/${CONTRACT}`);
  }
});

Deno.test("Channel A — every reference-emitting agent preloads the contract", () => {
  for (const name of CHANNEL_A) {
    const e = entry("agent", name);
    assert(e, `agent ${name} missing from CORE_BUNDLE`);
    const fm = e.content.match(/^---\n([\s\S]*?)\n---/);
    assert(fm, `agent ${name} has no frontmatter`);
    const line = fm[1].split("\n").find((l) => /^skills:\s/.test(l));
    assert(line, `agent ${name} must have a \`skills:\` line — it emits backlog references`);
    assertStringIncludes(line, CONTRACT);
  }
});

Deno.test("Channel B — every non-preloading surface carries the pointer", () => {
  for (const { category, name } of CHANNEL_B_CORE) {
    const e = entry(category, name);
    assert(e, `${category}/${name} missing from CORE_BUNDLE`);
    assertStringIncludes(
      e.content,
      CONTRACT,
      `${category}/${name} mentions backlog items but does not point at the contract`,
    );
  }
  for (const { harness, dest } of CHANNEL_B_STATIC) {
    const file = HARNESS_STATIC[harness]?.[dest];
    assert(file, `${harness} ${dest} missing from HARNESS_STATIC`);
    assertStringIncludes(file.content, CONTRACT, `${harness} ${dest} lacks the pointer`);
  }
});

Deno.test("groom.md's local restatement was replaced, not left beside the pointer", () => {
  const e = entry("backlog-doc", "board")!;
  assert(
    !e.content.includes('#<num> "<short title>"'),
    "groom.md must not keep its own partial statement of the rule alongside the pointer",
  );
  assertStringIncludes(e.content, "<backlog-reference>");
});

Deno.test("merge.md's confirmation prompt no longer names a bare number", () => {
  const e = entry("phase", "merge")!;
  assert(
    !e.content.includes('"Close issue #<linked_issue> on the board now?'),
    "the approval prompt must name the item per the contract, not by bare number",
  );
});

// ---------------------------------------------------------------------------
// Behaviour of the per-backend `item_url` helpers.
// ---------------------------------------------------------------------------

const SCRIPTS = "../../templates/core/skills/board/scripts";

/**
 * Lays a backend's scripts out so `_config.sh` resolves a project root three
 * levels up, and drops the given backlog-config.yml beside it.
 */
async function backendHarness(backend: string, config: string | null): Promise<string> {
  const tmp = await Deno.makeTempDir({ prefix: `item-url-${backend}-` });
  const dir = `${tmp}/board/scripts/${backend}`;
  await Deno.mkdir(dir, { recursive: true });
  await Deno.mkdir(`${tmp}/.specnaut`, { recursive: true });
  const src = fromFileUrl(new URL(`${SCRIPTS}/${backend}/_config.sh`, import.meta.url));
  await Deno.copyFile(src, `${dir}/_config.sh`);
  if (config !== null) {
    await Deno.writeTextFile(`${tmp}/.specnaut/backlog-config.yml`, config);
  }
  return tmp;
}

/**
 * `_config.sh` resolves the project root from `dirname "$0"`, so it must be
 * sourced *by a script in the same directory* — sourcing it from `bash -c`
 * would make `$0` "bash" and break the lookup. This wrapper is how the real
 * backend scripts consume it.
 */
async function runItemUrl(
  tmp: string,
  backend: string,
  args: string,
): Promise<{ code: number; out: string }> {
  const dir = `${tmp}/board/scripts/${backend}`;
  await Deno.writeTextFile(
    `${dir}/probe.sh`,
    `#!/usr/bin/env bash\nset -euo pipefail\n. "$(dirname "$0")/_config.sh"\n${args}\n`,
  );
  const { code, stdout } = await new Deno.Command("bash", {
    args: [`${dir}/probe.sh`],
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { code, out: new TextDecoder().decode(stdout).trim() };
}

async function itemUrl(tmp: string, backend: string, num: string): Promise<string> {
  const { out } = await runItemUrl(tmp, backend, `item_url ${num}`);
  return out;
}

Deno.test("github item_url builds the issue URL from `repo`", async () => {
  const tmp = await backendHarness("github", 'repo: "acme/my-app"\nproject_number: 7\n');
  assertEquals(await itemUrl(tmp, "github", "42"), "https://github.com/acme/my-app/issues/42");
});

Deno.test("cloud item_url emits nothing — the documented no-link fallback", async () => {
  // Cloud carries an API base, not a web origin. Deriving one would send the
  // user somewhere that does not exist, so the contract says: no link.
  const src = await Deno.readTextFile(
    fromFileUrl(new URL(`${SCRIPTS}/cloud/_config.sh`, import.meta.url)),
  );
  assertStringIncludes(src, "item_url()");
  assert(
    !/item_url\(\)[\s\S]{0,400}\$API_URL[^\n]*echo/.test(src),
    "cloud item_url must never build a URL from the API host",
  );
});

/**
 * GitLab is the only backend whose helper does real work: `project_id` is
 * dual-form, and the numeric form has no browser path, so it must be resolved
 * through the API. These stub `glab` to exercise all three paths offline.
 */
async function gitlabHarness(projectId: string, glabBody: string): Promise<string> {
  const tmp = await backendHarness(
    "gitlab",
    `host: "https://gitlab.example.com"\nproject_id: "${projectId}"\n`,
  );
  await Deno.mkdir(`${tmp}/bin`, { recursive: true });
  await Deno.writeTextFile(`${tmp}/bin/glab`, `#!/usr/bin/env bash\n${glabBody}\n`);
  await Deno.chmod(`${tmp}/bin/glab`, 0o755);
  return tmp;
}

async function gitlabItemUrl(tmp: string, num: string): Promise<{ code: number; out: string }> {
  const dir = `${tmp}/board/scripts/gitlab`;
  await Deno.writeTextFile(
    `${dir}/probe.sh`,
    `#!/usr/bin/env bash\nset -euo pipefail\n. "$(dirname "$0")/_config.sh"\nitem_url ${num}\n`,
  );
  // PATH goes through the process environment, not an `export` inside the
  // script: on Windows, bash converts an inherited PATH to POSIX form at
  // startup, but a native path assigned inside the script is left as-is and the
  // stub becomes unfindable. That failure is silent here — the helper degrades
  // to no output — so the degradation case would pass for the wrong reason.
  const { code, stdout } = await new Deno.Command("bash", {
    args: [`${dir}/probe.sh`],
    env: { PATH: `${tmp}/bin:${Deno.env.get("PATH")}` },
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { code, out: new TextDecoder().decode(stdout).trim() };
}

Deno.test("gitlab item_url links directly when project_id is a path", async () => {
  // The path form needs no lookup, so the stub refuses to be called at all.
  const tmp = await gitlabHarness("acme/my-app", 'echo "glab must not be called" >&2; exit 1');
  const { code, out } = await gitlabItemUrl(tmp, "42");
  assertEquals(code, 0);
  assertEquals(out, "https://gitlab.example.com/acme/my-app/-/issues/42");
});

Deno.test("gitlab item_url resolves a numeric project_id through the API", async () => {
  const tmp = await gitlabHarness(
    "1234",
    `echo '{"id":1234,"path_with_namespace":"acme/my-app"}'`,
  );
  const { code, out } = await gitlabItemUrl(tmp, "42");
  assertEquals(code, 0);
  assertEquals(out, "https://gitlab.example.com/acme/my-app/-/issues/42");
});

Deno.test("gitlab item_url degrades when the numeric lookup fails", async () => {
  // No honest URL exists here, so the contract says emit none — and, above all,
  // do not guess a path from the id.
  const tmp = await gitlabHarness(
    "1234",
    'echo "ran" > "$(dirname "$0")/../called"; echo "401 unauthorized" >&2; exit 1',
  );
  const { code, out } = await gitlabItemUrl(tmp, "42");
  assertEquals(out, "", "a failed lookup must yield no link, not a guessed one");
  assertEquals(code, 0, "degradation must never fail the caller");
  // Guard against a false pass: an unfindable stub also yields empty output.
  await Deno.stat(`${tmp}/called`);
});

Deno.test("local item_url resolves the task file, and stays quiet when absent", async () => {
  const tmp = await backendHarness("local", null);
  await Deno.mkdir(`${tmp}/.specnaut/backlog`, { recursive: true });
  await Deno.writeTextFile(`${tmp}/.specnaut/backlog/007-add-pagination.md`, "# task\n");

  assertEquals(
    await itemUrl(tmp, "local", "7"),
    ".specnaut/backlog/007-add-pagination.md",
    "a Markdown backlog has no browser URL, but it does have a file",
  );
  assertEquals(await itemUrl(tmp, "local", "999"), "", "no task file ⇒ no link, no error");
});

Deno.test("item_url never fails, whatever the state", async () => {
  // Degradation must never block a workflow: every helper exits 0 even with a
  // missing argument or an unresolvable item.
  for (const backend of ["github", "local"]) {
    const tmp = await backendHarness(
      backend,
      backend === "github" ? 'repo: "acme/my-app"\nproject_number: 7\n' : null,
    );
    const { code } = await runItemUrl(tmp, backend, 'item_url\nitem_url ""');
    assertEquals(code, 0, `${backend} item_url must not fail on a missing argument`);
  }
});
