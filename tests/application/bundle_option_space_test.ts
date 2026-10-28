import { assert, assertEquals } from "@std/assert";
import { BUNDLE_OPTION_DOMAINS, everyBundleOption } from "../../src/application/bundle_options.ts";

Deno.test("the parameter space is the product of its value domains", () => {
  // Derive BOTH sides. Hard-coding 32 here would make this the next thing that
  // stops noticing — which is the defect it exists to prevent, not a shortcut
  // around it.
  const expected = Object.values(BUNDLE_OPTION_DOMAINS)
    .reduce((n, domain) => n * domain.length, 1);
  assertEquals(everyBundleOption().length, expected);
  // Non-vacuity: a domain that went empty would make `expected` 0 and the
  // assertion above would pass over an empty product.
  assert(expected > 1, `parameter space collapsed to ${expected}`);
});

Deno.test("every field of BundleOptions has a value domain", () => {
  // The compile-time guarantee is the real one — a field added to
  // BundleOptions makes BUNDLE_OPTION_DOMAINS fail to compile (observed:
  // TS2741, on an *optional* field, which is the case that let specAutogen
  // slip). This asserts the runtime shape so a future `as` cast cannot quietly
  // discard it.
  for (const [key, domain] of Object.entries(BUNDLE_OPTION_DOMAINS)) {
    assert(domain.length > 0, `${key} has an empty value domain`);
  }
});

Deno.test("every combination is distinct and fully populated", () => {
  const combos = everyBundleOption();
  const keys = Object.keys(BUNDLE_OPTION_DOMAINS);
  const seen = new Set<string>();
  for (const combo of combos) {
    const record = combo as unknown as Record<string, unknown>;
    for (const key of keys) {
      assert(key in record, `combination is missing ${key}: ${JSON.stringify(combo)}`);
    }
    seen.add(JSON.stringify(keys.map((k) => record[k])));
  }
  assertEquals(seen.size, combos.length, "the cross-product produced a duplicate");
});
