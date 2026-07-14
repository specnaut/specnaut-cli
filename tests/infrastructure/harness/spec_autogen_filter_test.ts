import { assertEquals } from "@std/assert";
import { applySpecAutogen } from "../../../src/infrastructure/harness/spec_autogen_filter.ts";
import type { CoreEntry } from "../../../src/domain/core_bundle.ts";
import type { BundleOptions } from "../../../src/application/ports.ts";

// Spec 021 — applySpecAutogen gates the `spec-autogen=on` guidance in the
// backlog skill on `specAutogen && specBackend === "cloud"`, and leaves every
// other category (and toggled-off render) untouched.

const skillContent = [
  "shared",
  "<!-- BEGIN: spec-autogen=on -->",
  "AUTOGEN",
  "<!-- END: spec-autogen=on -->",
].join("\n");

function backlogSkill(): CoreEntry {
  return {
    category: "backlog-skill",
    name: "backlog",
    suffix: null,
    content: skillContent,
    executable: false,
  };
}

function opts(specBackend: "local" | "cloud", specAutogen?: boolean): BundleOptions {
  return { backlogBackend: "cloud", versionScheme: "semver", specBackend, specAutogen };
}

Deno.test("applySpecAutogen keeps the guidance only when specAutogen && cloud", () => {
  assertEquals(
    applySpecAutogen(backlogSkill(), opts("cloud", true)).content.includes("AUTOGEN"),
    true,
  );
  assertEquals(
    applySpecAutogen(backlogSkill(), opts("cloud", false)).content.includes("AUTOGEN"),
    false,
  );
  assertEquals(
    applySpecAutogen(backlogSkill(), opts("local", true)).content.includes("AUTOGEN"),
    false,
  );
  // Absent toggle defaults to off.
  assertEquals(applySpecAutogen(backlogSkill(), opts("cloud")).content.includes("AUTOGEN"), false);
});

Deno.test("applySpecAutogen only transforms `backlog-skill` entries; other categories pass through", () => {
  const phase: CoreEntry = {
    category: "phase",
    name: "tasks",
    suffix: "tasks.md",
    content: skillContent,
    executable: false,
  };
  // A phase entry with the same markers is returned content-untouched even when
  // the toggle would otherwise strip the block.
  assertEquals(applySpecAutogen(phase, opts("cloud", false)).content, skillContent);
});
