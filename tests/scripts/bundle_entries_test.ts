import { assertEquals } from "@std/assert";
import {
  coreEntry,
  harnessStatic,
  managedSectionField,
  staticFilesByHarness,
} from "../../scripts/bundle-entries.ts";
import type { Manifest } from "../../scripts/bundle-manifest.ts";

/** The bundle's entries are written as `deno fmt` would leave them, so a bundle run is clean. */

const entry = { category: "skills", name: "plan", source: "skills/plan.md" };

Deno.test("a core entry carries its defaults, and its optional fields only when set", () => {
  assertEquals(
    coreEntry(entry, "body\n", 100),
    '  {\n    category: "skills",\n    name: "plan",\n    suffix: null,\n' +
      "    content: `body\n`,\n    executable: false,\n    backend: null,\n" +
      "    skipIfExists: false,\n  }",
  );
  const full = {
    ...entry,
    suffix: ".md",
    executable: true,
    backend: "github" as const,
    skipIfExists: true,
    projectOwned: true,
    managedSection: "Rules",
  };
  assertEquals(
    coreEntry(full, "x", 100).split("\n").slice(3).join("\n"),
    '    suffix: ".md",\n    content: `x`,\n    executable: true,\n    backend: "github",\n' +
      '    skipIfExists: true,\n    projectOwned: true,\n    managedSection: "Rules",\n  }',
  );
});

Deno.test("managed labels stay on one line up to the width, then break one per line", () => {
  assertEquals(managedSectionField([], 100), "");
  assertEquals(managedSectionField(["A", "B"], 100), '    managedSection: ["A", "B"],\n');
  assertEquals(
    managedSectionField(["A", "B"], 20),
    '    managedSection: [\n      "A",\n      "B",\n    ],\n',
  );
  // One label is a string at any length: fmt never breaks it.
  assertEquals(managedSectionField(["A long one"], 5), '    managedSection: "A long one",\n');
});

Deno.test("harness files are grouped by sorted harness, a link's content being its fallback", async () => {
  const manifest: Manifest = {
    version: "1",
    core: [],
    harness_static: [
      { harness: "zed", destination: "z.json", source: "z.json", mergeJson: "codex-hooks" },
      { harness: "claude", destination: "CLAUDE.md", link: "../AGENTS.md", fallback: "@AGENTS.md" },
      { harness: "claude", destination: "run.sh", source: "run.sh", executable: true },
    ],
  };
  const files = await staticFilesByHarness(manifest, (s) => Promise.resolve(`text of ${s}`));
  assertEquals(Object.keys(files), ["zed", "claude"]);
  assertEquals(files.claude[0].content, "@AGENTS.md\n");
  assertEquals(
    harnessStatic(files, 100),
    '  "claude": {\n    "CLAUDE.md": {\n      content: `@AGENTS.md\n`,\n      executable: false,\n' +
      '      symlinkTo: "../AGENTS.md",\n    },\n    "run.sh": {\n      content: `text of run.sh`,\n' +
      '      executable: true,\n    },\n  },\n  "zed": {\n    "z.json": {\n' +
      '      content: `text of z.json`,\n      executable: false,\n      mergeJson: "codex-hooks",\n' +
      "    },\n  }",
  );
});
