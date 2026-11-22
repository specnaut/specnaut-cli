import { fileExists } from "../../infrastructure/fs_backup.ts";

/**
 * What `specnaut verify-scripts` and `specnaut record-approvals` share: each runs from a project's
 * root for a caller that parses its lines (the merge phase, `land-feature.sh`), and leaves what it
 * writes in a new temp file outside the repository, which that caller removes. Their exits 2 and 3
 * mean the same in both, so they are spelled here once.
 */
export const VERIFIER_EXIT = { usage: 2, couldNotRun: 3 } as const;

/** Says why the command stops, in its own words and on its own streams, and returns `code`. */
export type Refuse = (code: number, why: string) => number;

/**
 * `check`, run in the project at `cwd`: exit 2 when no `.specnaut/` is there, and exit 3 for
 * anything it throws, a folder that cannot even be looked at included, each said through `refuse`.
 */
export async function inProject(
  cwd: string,
  refuse: Refuse,
  check: () => Promise<number>,
): Promise<number> {
  try {
    if (!await fileExists(`${cwd}/.specnaut`)) {
      return refuse(VERIFIER_EXIT.usage, "no .specnaut/ here: run it from the project's root");
    }
    return await check();
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return refuse(VERIFIER_EXIT.couldNotRun, `the check could not run: ${why}`);
  }
}

/** A writer of a text to a new temp file named `<prefix>…` in the OS temp folder: its path. */
export function tempFileWriter(prefix: string): (text: string) => Promise<string> {
  return async (text) => {
    const path = await Deno.makeTempFile({ prefix });
    await Deno.writeTextFile(path, text);
    return path;
  };
}
