/**
 * Whether something is at `path`, the last name not followed. Only `NotFound` means absent: any
 * other error (a permission, a path through a file) is rethrown, so a test asserting absence cannot
 * pass on a path it never managed to look at.
 */
export async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}
