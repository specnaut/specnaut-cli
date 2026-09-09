import { resolve } from "@std/path";
import { bold, cyan, dim, green, red, yellow } from "@std/fmt/colors";
import { DiffProjectUseCase, type DivergenceResult } from "../../application/diff_project.ts";
import { DenoFsReader } from "../../infrastructure/fs_reader.ts";
import { FsLockStore } from "../../infrastructure/fs_lock_store.ts";
import { findHarness } from "../harnesses.ts";
import { CORE_BUNDLE } from "../../templates_bundle.ts";
import { renderUnifiedDiff } from "../../domain/diff.ts";

export type DiffIntent = {
  kind: "diff";
  /** `--only-customised`: restrict to paths whose disk SHA ≠ lock SHA. */
  onlyCustomised: boolean;
  /** Optional single managed path to scope the view to; `null` = whole project. */
  path: string | null;
};

/**
 * `specnaut diff` (spec 011 / issue #367, US2) — render, read-only, how each
 * managed file on disk diverges from the bundled original for the installed
 * templates version (FR-006).
 *
 * Wires only read-capable adapters (reader + lock store + the embedded bundle):
 * the use case has no writer, so the command mutates nothing (contract §4). A
 * present diff is success — the exit code is non-zero only on a genuine error
 * (e.g. an unknown harness in the lock).
 */
export async function runDiff(intent: DiffIntent): Promise<number> {
  const projectDir = resolve(Deno.cwd());

  const useCase = new DiffProjectUseCase({
    reader: new DenoFsReader(),
    lockStore: new FsLockStore(),
    core: CORE_BUNDLE,
    findHarness,
  });

  let result;
  try {
    result = await useCase.execute({
      projectDir,
      onlyCustomised: intent.onlyCustomised,
      path: intent.path,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(red(`error: ${msg}`));
    return 2;
  }

  // A path that could not be answered exits non-zero and NAMES what it could
  // not find. Falling through to the whole-project view here is what let a
  // typo, a path outside the bundle, and a correct path all print a confident
  // diff and exit 0 — so the maintenance walk a preserve declaration creates
  // read "no meaningful drift" for a question that was never asked (#594).
  if (result.pathProblem !== null) {
    const what = intent.path ?? "";
    if (result.pathProblem === "not-managed") {
      console.error(red(`error: ${what} is not a managed file`));
      console.error(
        dim(
          `  nothing in .specnaut/installed.lock tracks it, so there is no ` +
            `bundled original to compare against.`,
        ),
      );
      console.error(dim(`  run "specnaut diff" with no path to list what is tracked.`));
    } else {
      console.error(red(`error: ${what} is tracked but absent from disk`));
      console.error(
        dim(`  the lock records it; restore or re-add it before diffing.`),
      );
    }
    return 2;
  }

  const differs = result.results.filter(
    (r): r is Extract<DivergenceResult, { kind: "differs" }> => r.kind === "differs",
  );
  const missing = result.results.filter((r) => r.kind === "missing");

  if (differs.length === 0 && missing.length === 0) {
    console.log(green(
      intent.path === null
        ? "✓ no divergence — every managed file matches the bundle"
        : `✓ no divergence — ${intent.path} matches the bundle`,
    ));
    return 0;
  }

  for (const r of differs) {
    console.log(bold(`\n---- diff: ${r.dest} ----`));
    console.log(renderUnifiedDiff(
      r.bundledContent,
      r.diskContent,
      `bundled ${r.dest}`,
      `on-disk ${r.dest}`,
    ));
  }

  for (const r of missing) {
    console.log(
      yellow(`missing  ${r.dest} — on disk, no longer in the bundle (kept)`),
    );
  }

  console.log();
  console.log(
    dim(
      `  ${differs.length} diverged, ${missing.length} dropped-upstream ` +
        `(templates ${result.fromVersion}) ${cyan("· read-only, nothing written")}`,
    ),
  );
  return 0;
}
