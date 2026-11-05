import { assert, assertEquals } from "@std/assert";
import { lines, repo, scan } from "./scan_fixture.ts";

/**
 * The JSON is a public contract other projects' agents read (plan A18): its shape is held by a
 * golden, and its size on a repository shaped like this one by SC-004. Regenerate the golden after a deliberate
 * change to the contract, and bump `schema_version` when a field changes meaning or goes away:
 *   UPDATE_SCAN_GOLDEN=1 deno test --allow-read --allow-write --allow-run --allow-env \
 *     tests/integration/scan_contract_test.ts
 */

const GOLDEN = new URL("../fixtures/scan/scan_golden.json", import.meta.url);

const fn = (name: string, body: number) => `function ${name}() {\n${"  x();\n".repeat(body)}}\n`;

async function contractRepo(): Promise<string> {
  return await repo({
    "src/app/long.ts": fn("long", 60) + fn("short", 2) + lines(150),
    "src/app/klass.py": `class Big:\n${"    x = 1\n".repeat(120)}`,
    "src/lib/mid.go": lines(250),
    "docs/constitution.md": lines(70),
    "scripts/run.sh": lines(10),
    "README.md": lines(5),
    "logo.bin": new Uint8Array([0, 1, 2]),
    ".specnaut/size-limits.yml": "class:\n  target: 100\n  ceiling: none\n",
  });
}

Deno.test("the JSON document matches its golden, field for field and in order", async () => {
  const r = await scan(await contractRepo(), "--format", "json", "--top", "3");
  assertEquals(r.code, 0, r.stderr);
  const got = JSON.stringify(JSON.parse(r.stdout), null, 2) + "\n";
  if (Deno.env.get("UPDATE_SCAN_GOLDEN") === "1") await Deno.writeTextFile(GOLDEN, got);
  // A Windows checkout may hand the golden back with CRLF line ends; the contract is the content.
  assertEquals(got, (await Deno.readTextFile(GOLDEN)).replaceAll("\r\n", "\n"));
});

/**
 * A repository shaped like this CLI's own (about 1,500 files in 140 folders, a fifth of the files
 * and most functions over a limit), its paths and names as long as this one's are on average, so
 * the bound does not drift with whatever the checkout holds today.
 */
async function repoLikeThisOne(): Promise<string> {
  const files: Record<string, string> = {};
  for (let i = 0; i < 1500; i++) {
    const name = `handleRequest${i}`;
    const unit = fn(name, 25) + (i % 8 === 0 ? `class Holder${i} {\n${lines(110)}}\n` : "");
    const pad = i % 7 === 0 ? 260 : i % 50 === 0 ? 520 : 10;
    files[`src/module_${i % 14}/feature_${i % 10}/file_${i}.ts`] = unit + lines(pad);
  }
  return await repo(files);
}

Deno.test("SC-004: a default JSON scan of a repository like this one is under 20 KB", async () => {
  const r = await scan(await repoLikeThisOne(), "--format", "json");
  assert(r.code === 0 || r.code === 1, r.stderr);
  const json = JSON.parse(r.stdout);
  assertEquals(json.schema_version, 1);
  assert(json.totals.tracked === 1500 && json.functions.truncated.total > 1000, "not this size");
  const bytes = new TextEncoder().encode(r.stdout).length;
  assert(bytes < 20_000, `the default JSON is ${bytes} bytes`);
});
