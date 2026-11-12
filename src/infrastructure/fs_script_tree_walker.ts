import type { ScriptTreeWalker } from "../application/script_trust_ports.ts";
import { SCRIPTS_DIR, type TreeWalk } from "../domain/script_trust.ts";
import { FsTreeWalker } from "./fs_tree_walker.ts";

/** `.specnaut/scripts/`, every entry below it: what `specnaut verify-scripts` judges. */
export class FsScriptTreeWalker implements ScriptTreeWalker {
  readonly #walker: FsTreeWalker;

  constructor(root: string) {
    this.#walker = new FsTreeWalker(root, "block");
  }

  walk(): Promise<TreeWalk> {
    return this.#walker.walk({ dir: SCRIPTS_DIR, deep: true });
  }
}
