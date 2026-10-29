import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  extractLegacySizeLimits,
  extractLegacyTargetSurface,
  type LegacySetting,
} from "../../src/domain/constitution_legacy_settings.ts";
import { readSizeLimits } from "../../src/domain/size_limits.ts";
import { TARGET_SURFACE_MAX } from "../../src/domain/ui_settings.ts";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";

/**
 * Spec 038, FR-010 and S4: a constitution written before the move may carry a
 * size table and a target-surface declaration. Upgrade carries a customised
 * one into its config; a default one needs nothing, and a value the new
 * readers would refuse is refused here, never written.
 */

const HEADING = "## Size" + " limits";
const table = (rows: string, exempt = "") =>
  `# Acme\n\n## Ship small\n\n${HEADING}\n\n| Unit | Target | Ceiling |\n| :--- | ---: | ---: |\n` +
  `${rows}\n${exempt}\n## After\n\n| file | 1 | 2 |\n`;
const DEFAULT_ROWS = "| file | 300 | 500 |\n| function | 30 | 50 |\n| constitution | 300 | 500 |";

const content = (r: LegacySetting) => r.kind === "extract" ? r.content : `(${r.kind})`;

Deno.test("no table, or the vanilla default table, carries nothing", () => {
  assertEquals(extractLegacySizeLimits("# Acme\n\n## Ship small\n"), { kind: "none" });
  assertEquals(extractLegacySizeLimits(table(DEFAULT_ROWS)), { kind: "none" });
  assertEquals(
    extractLegacySizeLimits(table(
      DEFAULT_ROWS.replace("300 | 500 |\n|", "300 | 500 |\n|")
        .replace("| constitution | 300 | 500 |", "| constitution | 60 | 100 |"),
    )),
    { kind: "none" },
  );
});

Deno.test("a customised table carries only what differs, and reads back as written", () => {
  const r = extractLegacySizeLimits(
    table(
      "| file | 250 | none |\n| function | 30 | 50 |\n| constitution | 80 | 120 |\n| class | 9 | 9 |",
      "Exempt: `*.lock`, `**/generated/**`",
    ),
  );
  assertEquals(r.kind, "extract");
  assertEquals(
    content(r),
    "file:\n  target: 250\n  ceiling: none\nconstitution:\n  target: 80\n  ceiling: 120\n" +
      'exempt:\n  - "*.lock"\n  - "**/generated/**"\n',
  );
  assertEquals(r.kind === "extract" ? r.dropped : [], ["class"]);
  const read = readSizeLimits(content(r));
  assertEquals(read.kind, "ok");
  if (read.kind === "ok") {
    assertEquals(read.limits.units.file, { target: 250, ceiling: null, source: "config" });
    assertEquals(read.limits.units.function.source, "default");
    assertEquals(read.limits.exempt, ["*.lock", "**/generated/**"]);
  }
});

Deno.test("an exempt line alone is a customisation", () => {
  assertEquals(
    content(extractLegacySizeLimits(table(DEFAULT_ROWS, "Exempt: `vendor/**`"))),
    'exempt:\n  - "vendor/**"\n',
  );
});

Deno.test("a table the old ratchet stopped on is refused, never written", () => {
  for (
    const [rows, why] of [
      ["| file | 3OO | 500 |", "'3OO'"],
      ["| file | $(id) | 500 |", "'$(id)'"],
      ["| file | 1234567890 | none |", "'1234567890'"],
      ["| file | 300 |", "not unit, target, ceiling"],
      ["| file | 300 | 500 | 7 |", "not unit, target, ceiling"],
      ["| File | 300 | 400 |", "'File'"],
      ["| files | 300 | 400 |", "'files'"],
      ["| file | 200 | 400 |\n| file | 300 | 500 |", "given twice"],
    ]
  ) {
    const r = extractLegacySizeLimits(table(rows));
    assertEquals(r.kind, "refuse", rows);
    assertStringIncludes(r.kind === "refuse" ? r.reason : "", why);
  }
  const noTable = extractLegacySizeLimits(`# A\n\n${HEADING}\n\nfiles stay small\n`);
  assertEquals(noTable.kind, "refuse");
  const glob = extractLegacySizeLimits(table(DEFAULT_ROWS, 'Exempt: `a"b`'));
  assertEquals(glob.kind, "refuse");
});

const surface = (body: string, heading = "### Target surface") =>
  `# Acme\n\n## Front-end patterns\n\n${heading}\n\n${body}\n\n## Next\n`;

Deno.test("an exact-form target surface carries its surface into ui.yml", () => {
  assertEquals(
    content(extractLegacyTargetSurface(surface("This project targets desktop viewports only."))),
    'target_surface: "desktop viewports only"\n',
  );
  // Hard-wrapped, CRLF: still one sentence.
  assertEquals(
    content(
      extractLegacyTargetSurface(
        surface("This project targets wide\nscreens in an operator console.").replaceAll(
          "\n",
          "\r\n",
        ),
      ),
    ),
    'target_surface: "wide screens in an operator console"\n',
  );
});

Deno.test("anything but the exact form is absent, as the contract always read it", () => {
  for (
    const text of [
      "# Acme\n\n### Target surface\n\nThis project targets desktop viewports only.\n",
      surface("This project targets desktop viewports only.", "## Target surface"),
      surface("This project targets desktop viewports only.", "#### Target surface"),
      surface("Mostly laptops, we think."),
      surface("This project targets desktops. Phones later."),
      surface("This project targets desktops.\n\nA second paragraph."),
      "# Acme\n\n## Other\n\n### Target surface\n\nThis project targets desktops.\n",
    ]
  ) assertEquals(extractLegacyTargetSurface(text), { kind: "none" }, text);
});

Deno.test("a declared surface the ui.yml reader would refuse is refused (S4)", () => {
  const long = extractLegacyTargetSurface(surface(`This project targets ${"x".repeat(121)}.`));
  assertEquals(long.kind, "refuse");
  assertStringIncludes(long.kind === "refuse" ? long.reason : "", "longer than 120");
  const quoted = extractLegacyTargetSurface(surface('This project targets "desktops".'));
  assertEquals(quoted.kind, "refuse");
  const exact = extractLegacyTargetSurface(surface(`This project targets ${"x".repeat(120)}.`));
  assertEquals(exact.kind, "extract");
});

Deno.test("the limit the binary writes is the one the contract states", () => {
  assertEquals(TARGET_SURFACE_MAX, 120);
  const contract = CORE_BUNDLE.find((e) => e.name === "mobile-first-contract")!.content;
  assertStringIncludes(contract.replace(/\s+/g, " "), "at most one hundred and twenty printable");
});
