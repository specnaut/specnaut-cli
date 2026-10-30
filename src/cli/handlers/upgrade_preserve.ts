import { yellow } from "@std/fmt/colors";
import { findHarness } from "../harnesses.ts";
import { FsPreserveStore } from "../../infrastructure/fs_preserve_store.ts";
import { resolvePreserveDeclarations } from "./preserve_resolution.ts";
import { isAgenticPath } from "../../domain/parent_managed.ts";
import { orphanScope } from "../../domain/orphan_scope.ts";
import { CORE_BUNDLE } from "../../templates_bundle.ts";
import type { InstalledLock } from "../../domain/installed_lock.ts";
import { CONSTITUTION_PATH, LEGACY_CONSTITUTION_PATH } from "../../domain/constitution_paths.ts";

/**
 * Upgrade's preserve declarations (spec 011 / issue #367): the effective ones,
 * and the predicate the use case threads into the plan, with every ineffective
 * declaration warned (FR-008). `--reset-preserved` forces the predicate off
 * (FR-005); `known` still names what it overrode.
 *
 * A declaration takes effect on a path Specnaut manages: one the bundle ships
 * for the lock's harness and backend, OR one the lock records within Specnaut's
 * folders (cli#668). The second is the declared path a release dropped — FR-009
 * keeps it, preservation winning over removal. Matched against the bundle alone
 * it was warned "not a managed file (ignored)" and then deleted as an ordinary
 * orphan, so the rule never once reached the disk.
 *
 * The parent-managed agentic filter is applied first, so a declared agentic
 * path in a parent-managed sub-repo is a clean no-op (D8).
 */
export async function resolveUpgradePreserves(
  projectDir: string,
  lock: InstalledLock | null,
  parentManaged: boolean,
  resetPreserved: boolean,
): Promise<{ known: ReadonlyArray<string>; isDeclaredPreserved: (dest: string) => boolean }> {
  const harness = lock === null ? undefined : findHarness(lock.harness);
  if (lock === null || !harness) return { known: [], isDeclaredPreserved: () => false };
  const mapped = harness.mapBundle(CORE_BUNDLE, {
    backlogBackend: lock.backlogBackend,
    versionScheme: lock.versionScheme,
    specBackend: lock.specBackend,
    specAutogen: lock.specAutogen,
  });
  // A lock key counts only where upgrade could act on it: outside Specnaut's
  // folders it is refused whatever it declares (cli#665). The same scope the
  // orphan path uses, exact-name files included — without them a declared
  // retired file was warned unmanaged, then deleted.
  const tracked = [...lock.entries.keys()].filter((d) =>
    orphanScope(d, harness.managedRoots, harness.managedFiles) === "in-scope"
  );
  const managed = [...Object.keys(mapped), ...tracked]
    .filter((d) => !parentManaged || !isAgenticPath(d));
  const store = new FsPreserveStore();
  await warnUnusableManifest(store, projectDir);
  const resolved = resolvePreserveDeclarations(await store.read(projectDir), managed);
  // The old constitution moves whatever preserve.yml says (spec 038): every
  // reader moved with it, so a preserved copy would be one nothing reads.
  const legacy = (p: string) => p === LEGACY_CONSTITUTION_PATH;
  if ([...resolved.known, ...resolved.unknown].some(legacy)) {
    console.error(yellow(
      `warn: ${LEGACY_CONSTITUTION_PATH} — declared preserved, but upgrade moves it to ` +
        `${CONSTITUTION_PATH}, which it never rewrites; remove the line from .specnaut/preserve.yml`,
    ));
  }
  const known = resolved.known.filter((p) => !legacy(p));
  for (const path of resolved.unknown.filter((p) => !legacy(p))) {
    console.error(yellow(`warn: ${path} — declared preserved but not a managed file (ignored)`));
  }
  const declared = new Set(resetPreserved ? [] : known);
  return { known, isDeclaredPreserved: (dest) => declared.has(dest) };
}

/**
 * A manifest that exists but declares nothing used to produce no output at
 * all — identical to having no manifest, so a maintainer read the silence as
 * protection while their files were refreshed. Advisory only: it never changes
 * the exit code, per the store's own contract.
 */
async function warnUnusableManifest(store: FsPreserveStore, projectDir: string): Promise<void> {
  const diagnosis = await store.diagnose(projectDir);
  if (diagnosis === null || diagnosis.kind === "ok") return;
  const why = diagnosis.kind === "unparseable"
    ? "not valid YAML"
    : diagnosis.kind === "missing-key"
    ? "no top-level `preserved:` key (a bare list is not one either)"
    : "`preserved:` is present but holds no usable paths";
  console.error(yellow(`warn: .specnaut/preserve.yml — ${why}; nothing is being preserved`));
}
