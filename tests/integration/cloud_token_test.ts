import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

async function runSpecflow(
  args: string[],
  env: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const p = new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", MAIN, ...args],
    env,
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await p.output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

Deno.test("`cloud token` echoes SPECFLOW_CLOUD_TOKEN (headless escape hatch)", async () => {
  const r = await runSpecflow(
    ["cloud", "token", "--api-url", "https://dep.convex.site"],
    { SPECFLOW_CLOUD_TOKEN: "sfc_headless_xyz", PATH: Deno.env.get("PATH") ?? "" },
  );
  assertEquals(r.code, 0, r.stderr);
  assertEquals(r.stdout.trim(), "sfc_headless_xyz");
});

Deno.test("`cloud token` with no env + no stored creds → exit 1 with guidance", async () => {
  // HOME points at an empty temp dir so there's no credentials file to find.
  const home = await Deno.makeTempDir({ prefix: "specflow-nohome-" });
  try {
    const r = await runSpecflow(
      ["cloud", "token", "--api-url", "https://dep.convex.site"],
      { HOME: home, PATH: Deno.env.get("PATH") ?? "" },
    );
    assertEquals(r.code, 1);
    assertStringIncludes(r.stderr, "cloud login");
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});
