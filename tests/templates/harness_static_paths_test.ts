import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { HARNESSES } from "../../src/cli/harnesses.ts";
import { KNOWN_BACKLOG_BACKENDS } from "../../src/domain/installed_lock.ts";
import type { BacklogBackend } from "../../src/domain/installed_lock.ts";
import { findBacklogStrategy } from "../../src/domain/backlog_strategies/registry.ts";
import type { Bundle } from "../../src/domain/template.ts";

/**
 * #612 — a harness template must not point at a path that the bundle for the
 * selected backend does not ship.
 *
 * `.claude/CLAUDE.md` told every Claude project that "custom Specnaut commands
 * live in `.claude/commands/`" — a directory v4.0.0 retired and `upgrade`
 * deletes — and sent a github-backed project to `.specnaut/backlog.md`, which
 * ships to the local backend only. Codex's `.codex/AGENTS.md` and Cursor's
 * `specify-rules.mdc` carried the same backlog line.
 *
 * The existing scans read raw template text; none of them asks what a project
 * actually RECEIVES. A pointer that resolves on one backend and dangles on
 * three reads as correct to anyone testing from a local-backend checkout. So
 * this renders every harness against every backend and resolves each path the
 * rendered file cites against the destinations that same bundle writes.
 */

const MANIFEST = fromFileUrl(new URL("../../templates/manifest.json", import.meta.url));

/**
 * The destinations whose SOURCE is a harness-specific Markdown template — the
 * tree #551 found no scan was reading. Derived from the manifest, not a hand
 * list: a new harness context file is scanned the day it is registered.
 */
async function harnessTemplateDestinations(): Promise<Map<string, string[]>> {
  const m = JSON.parse(await Deno.readTextFile(MANIFEST)) as {
    harness_static: Array<{ harness: string; destination: string; source: string }>;
  };
  const out = new Map<string, string[]>();
  for (const e of m.harness_static) {
    if (!e.source.startsWith("harness-specific/")) continue;
    if (!/\.(md|mdc)$/.test(e.source)) continue;
    out.set(e.harness, [...(out.get(e.harness) ?? []), e.destination]);
  }
  return out;
}

/**
 * Paths a template may cite that no bundle writes, each with who creates them.
 * `backends` narrows where the citation is legitimate; absent ⇒ every backend.
 * A row here is a statement about the installed project — never a way to
 * quiet a red.
 */
const CREATED_OUTSIDE_THE_BUNDLE: Record<
  string,
  { reason: string; backends?: readonly BacklogBackend[] }
> = {
  ".claude/worktrees/": {
    reason: "created by Claude Code's agent view for isolated sessions, not by Specnaut",
  },
  ".claude/claude-security-guidance.local.md": {
    reason: "the user's optional override; Specnaut documents it and never writes it",
  },
  ".specnaut/backlog/": {
    reason: "the local backend's add script creates one file per item on first use",
    backends: ["local"],
  },
};

/**
 * `.specnaut/backlog-config.yml` is written by `init` beside the bundle rather
 * than through it. Whether a backend gets one is the strategy's answer, not a
 * list kept here: a new zero-config backend is covered without editing this.
 */
function writtenBesideTheBundle(backend: BacklogBackend): Set<string> {
  return findBacklogStrategy(backend).initConfigStub() === null
    ? new Set()
    : new Set([".specnaut/backlog-config.yml"]);
}

/** Backtick-quoted, project-relative paths under a dot-directory. */
const CITED_PATH = /`(\.[A-Za-z][\w.-]*\/[^`\s]*)`/g;

function citedPaths(content: string): string[] {
  return [...content.matchAll(CITED_PATH)].map((m) => m[1]);
}

/**
 * A citation resolves when it names a written file, or a directory at least
 * one written file sits under. A placeholder (`NNN-*.md`, `<name>`, `$AGENT`)
 * is resolved on the literal directory in front of it.
 */
function resolves(path: string, destinations: readonly string[]): boolean {
  const placeholder = path.search(/[<*${]|NNN/);
  const literal = placeholder === -1 ? path : path.slice(0, path.lastIndexOf("/", placeholder) + 1);
  if (literal.endsWith("/")) return destinations.some((d) => d.startsWith(literal));
  return destinations.includes(literal) || destinations.some((d) => d.startsWith(`${literal}/`));
}

function excused(path: string, backend: BacklogBackend): boolean {
  for (const [prefix, rule] of Object.entries(CREATED_OUTSIDE_THE_BUNDLE)) {
    if (!path.startsWith(prefix)) continue;
    if (rule.backends === undefined || rule.backends.includes(backend)) return true;
  }
  return false;
}

function bundleFor(harnessKey: string, backend: BacklogBackend): Bundle {
  const harness = HARNESSES.find((h) => h.key === harnessKey);
  assert(harness, `manifest names a harness the CLI does not register: ${harnessKey}`);
  return harness.mapBundle(CORE_BUNDLE, {
    backlogBackend: backend,
    versionScheme: "semver",
    specBackend: "local",
    specAutogen: false,
  });
}

Deno.test("every path a harness template cites is shipped by that backend's bundle", async () => {
  const templates = await harnessTemplateDestinations();
  assert(
    templates.size > 0,
    "no harness-specific Markdown in the manifest — the scan reads nothing",
  );

  const dangling: string[] = [];
  let checked = 0;
  for (const [harnessKey, dests] of templates) {
    for (const backend of KNOWN_BACKLOG_BACKENDS) {
      const bundle = bundleFor(harnessKey, backend);
      const destinations = [...Object.keys(bundle), ...writtenBesideTheBundle(backend)];
      for (const dest of dests) {
        const file = bundle[dest];
        assert(file, `${harnessKey}: ${dest} is registered but not written`);
        for (const path of citedPaths(file.content)) {
          checked++;
          if (resolves(path, destinations) || excused(path, backend)) continue;
          dangling.push(`${harnessKey} × ${backend}: ${dest} cites \`${path}\``);
        }
      }
    }
  }
  // Non-vacuity: a regex that stopped matching would report a clean surface.
  assert(checked > 20, `only ${checked} citations scanned — the extractor is not reading`);
  assertEquals(
    dangling,
    [],
    "these point a project at a path its bundle never wrote — reword the " +
      "template, gate the line behind a backend marker, or add a justified " +
      "row to CREATED_OUTSIDE_THE_BUNDLE if something else creates it",
  );
});

Deno.test("the backlog pointer names the backend the project actually uses", () => {
  // The scan above is satisfied by deleting the backlog line outright. This
  // asserts what each rendering must SAY, per backend, on every harness that
  // carries the pointer.
  const CARRIERS: Array<[string, string]> = [
    ["claude", ".claude/CLAUDE.md"],
    ["codex", ".codex/AGENTS.md"],
    ["cursor", ".cursor/rules/specify-rules.mdc"],
  ];
  const wrong: string[] = [];
  for (const [harnessKey, dest] of CARRIERS) {
    for (const backend of KNOWN_BACKLOG_BACKENDS) {
      const content = bundleFor(harnessKey, backend)[dest]?.content ?? "";
      const pointsAtIndex = content.includes("`.specnaut/backlog.md`");
      const pointsAtConfig = content.includes("`.specnaut/backlog-config.yml`");
      const local = backend === "local";
      if (pointsAtIndex !== local) {
        wrong.push(`${harnessKey} × ${backend}: backlog.md ${pointsAtIndex ? "cited" : "missing"}`);
      }
      if (pointsAtConfig === local) {
        wrong.push(
          `${harnessKey} × ${backend}: backlog-config.yml ${pointsAtConfig ? "cited" : "missing"}`,
        );
      }
      if (content.includes("<!-- BEGIN: backend=") || content.includes("<!-- END: backend=")) {
        wrong.push(`${harnessKey} × ${backend}: backend markers reached the project unrendered`);
      }
    }
  }
  assertEquals(wrong, []);
});

Deno.test("the allow-list has no dead entries", async () => {
  // An excuse for a path no template cites any more is a claim nobody checks.
  const templates = await harnessTemplateDestinations();
  const cited = new Set<string>();
  for (const [harnessKey, dests] of templates) {
    for (const backend of KNOWN_BACKLOG_BACKENDS) {
      const bundle = bundleFor(harnessKey, backend);
      for (const dest of dests) {
        for (const p of citedPaths(bundle[dest]?.content ?? "")) cited.add(p);
      }
    }
  }
  assertEquals(
    Object.keys(CREATED_OUTSIDE_THE_BUNDLE).filter((k) => ![...cited].some((p) => p.startsWith(k))),
    [],
    "excused but no longer cited — drop them",
  );
});
