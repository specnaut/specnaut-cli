import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { CORE_BUNDLE, HARNESS_STATIC } from "../../src/templates_bundle.ts";

/**
 * The product owner's summary is a report, never an instruction (task/backlog.md,
 * "The session protocol", step 7). A note it suggests is shown to the user as
 * quoted text and written to memory only on the user's own instruction: no
 * bundled file tells the session to write memory from that summary. The sweep
 * reads every core and harness-specific file, sentence by sentence, with a
 * floor so it cannot pass by reading nothing.
 */

/** A sentence that has the session write, save or record something the summary or a suggestion holds. */
const WRITES_FROM_SUMMARY = [
  /\b(summary|suggest\w*)\b[^.;]{0,160}\b(the|main) session\b[^.;]{0,40}\b(writes?|saves?|records?|adds?|stores?)\b/i,
  /\b(the|main) session\b[^.;]{0,40}\b(writes?|saves?|records?|adds?|stores?)\b[^.;]{0,160}\b(summary|suggest\w*)\b/i,
];

const MEMORY = /memory|MEMORY\.md/;

Deno.test("no bundled file tells the session to write memory from the product owner's summary", () => {
  const files: Array<[string, string]> = [
    ...CORE_BUNDLE.map((e): [string, string] => [`${e.name}/${e.suffix ?? "-"}`, e.content]),
    ...Object.entries(HARNESS_STATIC).flatMap(([h, fs]) =>
      Object.entries(fs).map(([path, f]): [string, string] => [`${h}:${path}`, f.content])
    ),
  ];
  const aboutMemory = files.filter(([, text]) => MEMORY.test(text));
  assert(aboutMemory.length >= 10, `the sweep read too few files: ${aboutMemory.length}`);
  const hits = aboutMemory.flatMap(([name, text]) =>
    text.replace(/\s+/g, " ").split(/(?<=[.;])\s/)
      .filter((s) => MEMORY.test(s) || /\bhere\b/.test(s))
      .filter((s) => WRITES_FROM_SUMMARY.some((re) => re.test(s)))
      .map((s) => `${name}: ${s}`)
  );
  assertEquals(hits, []);
});

Deno.test("the product owner's memory index is written on the user's instruction only", () => {
  const index = CORE_BUNDLE.find((e) => e.content.startsWith("# Product Owner agent memory"));
  assert(index, "the product owner's MEMORY.md is not bundled");
  assertStringIncludes(index.content.replace(/\s+/g, " "), "only on the user's own instruction");
});
