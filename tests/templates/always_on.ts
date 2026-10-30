import { fromFileUrl } from "@std/path";

/**
 * The always-on destinations of every harness, from `alwaysOn` in the
 * manifest — not a hand list. The generated `HARNESS_STATIC` does not carry the
 * flag (the bundler only passes it through to the tests that read it), so the
 * manifest is the one place it can be read from. Shared by every test that asks
 * what a harness loads into every session.
 */
export async function alwaysOnDestinations(): Promise<Map<string, string[]>> {
  const raw = await Deno.readTextFile(
    fromFileUrl(new URL("../../templates/manifest.json", import.meta.url)),
  );
  const m = JSON.parse(raw) as {
    harness_static: Array<{ harness: string; destination: string; alwaysOn?: boolean }>;
  };
  const out = new Map<string, string[]>();
  for (const e of m.harness_static) {
    if (!e.alwaysOn) continue;
    out.set(e.harness, [...(out.get(e.harness) ?? []), e.destination]);
  }
  return out;
}
