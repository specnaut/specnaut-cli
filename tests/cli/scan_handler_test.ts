import { assertEquals, assertStringIncludes } from "@std/assert";
import { runScan, type ScanDeps } from "../../src/cli/handlers/scan_handler.ts";
import type { ScanRepository } from "../../src/application/structural_scan_ports.ts";
import { readSizeLimits } from "../../src/domain/size_limits.ts";

/**
 * Exit 1 means one thing, a file over its ceiling (plan A4): whatever else goes wrong once the
 * handler has started ends in 3, with the reason on stderr, and never in a trace `main.ts` turns
 * into a 1.
 */

const intent = { kind: "scan" as const, path: null, format: "json" as const, top: 20 as const };

function deps(open: ScanDeps["open"]) {
  const seen = { out: [] as string[], err: [] as string[] };
  const d: ScanDeps = {
    cwd: "/x",
    out: (s) => seen.out.push(s),
    err: (s) => seen.err.push(s),
    open,
  };
  return { d, seen };
}

/** A repository with one regular file, whose read fails as `read` says. */
function repository(read: ScanRepository["read"]): ScanRepository {
  return {
    sizeConfig: () => Promise.resolve(readSizeLimits(null)),
    lockEntries: () => Promise.resolve({ kind: "ok", paths: new Set() }),
    listTracked: () =>
      Promise.resolve({ entries: [{ path: "a.ts", mode: "file" }], undecodable: 0 }),
    diffAttributes: () => Promise.resolve(new Map()),
    read,
  };
}

Deno.test("an unexpected error while reading is exit 3, said once, never a 1", async () => {
  const { d, seen } = deps(() =>
    Promise.resolve(repository(() => Promise.reject(new TypeError("boom\x1b[2J"))))
  );
  assertEquals(await runScan(intent, d), 3);
  assertEquals(seen.out, []);
  assertStringIncludes(seen.err.join("\n"), "specnaut scan could not run: boom\\u001b[2J");
});

Deno.test("a repository that cannot be opened is exit 3", async () => {
  const { d, seen } = deps(() => Promise.reject(new Error("refusing the home directory")));
  assertEquals(await runScan(intent, d), 3);
  assertStringIncludes(seen.err.join("\n"), "refusing the home directory");
});

Deno.test("a map within its ceilings is exit 0, and one over a ceiling is exit 1", async () => {
  const lines = (n: number) => () =>
    Promise.resolve({ kind: "text" as const, lines: n, text: null });
  const within = deps(() => Promise.resolve(repository(lines(500))));
  assertEquals(await runScan(intent, within.d), 0);
  assertEquals(JSON.parse(within.seen.out[0]).totals.measured, 1);
  const over = deps(() => Promise.resolve(repository(lines(501))));
  assertEquals(await runScan(intent, over.d), 1);
});
