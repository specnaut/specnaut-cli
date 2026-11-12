import { join } from "@std/path";
import { FsExportStore } from "../../src/infrastructure/fs_tree_export.ts";

/**
 * A process for `fs_tree_export_test.ts`: stages an export, prints the staged path, then ends as
 * asked (`exit`, `return`, or `signal`: it waits to be killed), so the test can see the exit trap
 * remove the folder after the process is gone.
 */
const [base, how] = Deno.args;
await Deno.mkdir(join(base, "project"), { recursive: true });
const store = new FsExportStore(join(base, "project"), join(base, "cache"));
console.log(await store.stage());
if (how === "exit") Deno.exit(0);
if (how === "signal") await new Promise((done) => setTimeout(done, 60_000));
