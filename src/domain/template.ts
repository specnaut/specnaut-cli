import { isAbsolute, normalize, SEPARATOR } from "@std/path";

export type TemplateFile = {
  content: string;
  executable: boolean;
};

export type Bundle = Record<string, TemplateFile>;

/**
 * Throws if the destination path is unsafe: absolute, or attempts to escape
 * the target directory via "..". Pure — no IO.
 */
export function assertSafeDestination(dest: string): void {
  const normalized = normalize(dest);
  if (isAbsolute(normalized)) {
    throw new Error(`Unsafe destination (absolute path): ${dest}`);
  }
  if (
    normalized === ".." ||
    normalized.startsWith(`..${SEPARATOR}`) ||
    normalized.includes(`${SEPARATOR}..${SEPARATOR}`) ||
    normalized.endsWith(`${SEPARATOR}..`)
  ) {
    throw new Error(`Unsafe destination (escape attempt): ${dest}`);
  }
}
