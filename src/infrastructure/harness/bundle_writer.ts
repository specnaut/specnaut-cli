import type { Bundle, TemplateFile } from "../../domain/template.ts";

/**
 * **The home of the no-two-entries-share-a-destination invariant** (spec 033
 * §5, FR-006).
 *
 * Every harness builds its `Bundle` as a plain object and assigns
 * `out[dest] = file`. A second assignment to the same key is a silent
 * overwrite: no error, no warning, and no type-level trace — one bundled file
 * simply never reaches the user, and the first symptom is a missing file in a
 * scaffolded project that nothing in the build could have reported.
 *
 * A test can *detect* that. It cannot be its home: a new category added without
 * extending the enumeration reintroduces the hazard with the gate still green.
 * So the refusal lives at the write site, where it cannot be forgotten, and the
 * test beside it is the second opinion rather than the only one.
 *
 * Scoped to the **core-entry** loop on purpose. `HARNESS_STATIC` is applied
 * afterwards and is allowed to sit on top of a core destination; that is a
 * different rule with a different owner, and folding the two here would change
 * behaviour under the guise of adding a guard.
 */
export function addUnique(
  out: Bundle,
  dest: string,
  file: TemplateFile,
  harnessKey: string,
): void {
  if (Object.hasOwn(out, dest)) {
    throw new Error(
      `${harnessKey}: two bundle entries map to the same destination ` +
        `"${dest}". One of them would silently overwrite the other, so the ` +
        `bundle is refused instead. Give one of the entries a distinct name ` +
        `or suffix — on a flat harness the owner prefix is the only thing ` +
        `separating two skills' documents.`,
    );
  }
  out[dest] = file;
}
