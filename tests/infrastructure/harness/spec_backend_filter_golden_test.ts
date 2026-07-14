import { assertEquals, assertNotEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { CORE_BUNDLE } from "../../../src/templates_bundle.ts";
import { renderSpecBackend } from "../../../src/domain/conditional_render.ts";
import { applySpecBackend } from "../../../src/infrastructure/harness/spec_backend_filter.ts";
import type { CoreEntry } from "../../../src/domain/core_bundle.ts";

// Spec 020 + 021 / SC-002 / FR-003 — LOCAL PARITY. The golden fixtures under
// tests/fixtures/*_local_golden.md are byte-for-byte copies of the phase docs as
// they shipped BEFORE `spec-backend=` marker blocks were added: specify.md /
// implement.md (spec 020) and review.md / analyze.md / tasks.md (spec 021, the
// cloud pull-on-entry blocks). This test proves the `local`-rendered phase docs
// are byte-identical to that pre-feature output — the mechanical guarantee that a
// `local` project sees zero behaviour change. If a future edit legitimately
// changes the local content, re-capture the fixture in the same commit; an
// accidental drift fails here.

function abs(rel: string): string {
  return fromFileUrl(new URL(`../../${rel}`, import.meta.url));
}

function phaseEntry(name: string): CoreEntry {
  const e = CORE_BUNDLE.find((x) => x.category === "phase" && x.name === name);
  if (!e) throw new Error(`missing phase entry: ${name}`);
  return e;
}

for (const name of ["specify", "implement", "review", "analyze", "tasks"]) {
  Deno.test(`${name}.md rendered for spec-backend=local is byte-identical to the pre-feature bundle`, async () => {
    // EOL-agnostic: a released binary always embeds LF (the bundle is compiled
    // from committed LF source), but Windows CI regenerates the bundle from a
    // CRLF checkout. Content parity — not the OS line-ending — is the FR-003
    // guarantee, so compare line-ending-agnostically.
    const lf = (s: string) => s.replaceAll("\r\n", "\n");
    const golden = lf(await Deno.readTextFile(abs(`fixtures/${name}_local_golden.md`)));
    const rendered = lf(renderSpecBackend(phaseEntry(name).content, "local"));
    assertEquals(
      rendered,
      golden,
      `local-rendered ${name}.md drifted from the pre-feature golden — FR-003 local parity broken.`,
    );
  });

  Deno.test(`${name}.md leaves no stray spec-backend markers in either render`, () => {
    const entry = phaseEntry(name);
    for (const backend of ["local", "cloud"] as const) {
      const out = renderSpecBackend(entry.content, backend);
      assertEquals(out.includes("spec-backend="), false);
      assertEquals(out.includes("BEGIN:"), false);
    }
  });
}

Deno.test("cloud render diverges from local for every marked phase doc (markers are consumed)", () => {
  for (const name of ["specify", "implement", "review", "analyze", "tasks"]) {
    const entry = phaseEntry(name);
    assertNotEquals(
      renderSpecBackend(entry.content, "cloud"),
      renderSpecBackend(entry.content, "local"),
    );
  }
  // The cloud specify block instructs pushing steps instead of writing files.
  assertEquals(
    renderSpecBackend(phaseEntry("specify").content, "cloud").includes("spec push"),
    true,
  );
  // The cloud implement block runs the branch-only decoupling point.
  assertEquals(
    renderSpecBackend(phaseEntry("implement").content, "cloud").includes("--branch-only"),
    true,
  );
});

Deno.test("applySpecBackend only transforms `phase` entries; other categories pass through", () => {
  const opts = {
    backlogBackend: "local" as const,
    versionScheme: "semver" as const,
    specBackend: "cloud" as const,
  };
  // A non-phase entry is returned unchanged (same object identity is not
  // required, but content must be untouched).
  const skill: CoreEntry = {
    category: "skill",
    name: "specnaut",
    suffix: null,
    content: "<!-- BEGIN: spec-backend=local -->kept<!-- END: spec-backend=local -->",
    executable: false,
  };
  assertEquals(applySpecBackend(skill, opts).content, skill.content);
});
