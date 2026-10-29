/**
 * `.specnaut/ui.yml` — the project's one exception to the mobile-first
 * default (spec 038, FR-009): `target_surface: "<surface>"`. Agents read it
 * through the `mobile-first-contract` skill; the binary only writes it, when
 * upgrade carries an old constitution's declaration over.
 */

/** The longest surface the file takes (S4). A declaration, not a design brief. */
export const TARGET_SURFACE_MAX = 120;

/**
 * Why `surface` cannot be written, or `null` when it can: one line of at most
 * 120 characters, none of them a control character, `"` or `\` — the value is
 * written double-quoted and must read back as itself.
 */
export function targetSurfaceProblem(surface: string): string | null {
  if (surface.trim() === "") return "it is empty";
  if ([...surface].length > TARGET_SURFACE_MAX) {
    return `it is longer than ${TARGET_SURFACE_MAX} characters`;
  }
  if (/[\p{Cc}"\\]/u.test(surface)) {
    return 'it holds a line break, a control character, `"` or `\\`';
  }
  return null;
}

/** The file for a surface `targetSurfaceProblem` cleared. */
export function uiSettingsYaml(surface: string): string {
  return `target_surface: "${surface}"\n`;
}
