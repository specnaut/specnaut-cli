import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

async function runSpecnaut(
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

Deno.test("`cloud token` echoes SPECNAUT_CLOUD_TOKEN (headless escape hatch)", async () => {
  const r = await runSpecnaut(
    ["cloud", "token", "--api-url", "https://api.example.com"],
    {
      SPECNAUT_CLOUD_TOKEN: "sfc_headless_xyz",
      SPECNAUT_CLOUD_API_URL: "https://api.example.com/",
      PATH: Deno.env.get("PATH") ?? "",
    },
  );
  assertEquals(r.code, 0, r.stderr);
  assertEquals(r.stdout.trim(), "sfc_headless_xyz");
});

// monorepo#44 — the headless token is bound to no deployment: it is handed over
// for the canonical endpoint or the one the environment names, never for a URL
// a repository chose (its api_url, or a command line it runs).
Deno.test("`cloud token` hands the headless token over for the canonical endpoint", async () => {
  const r = await runSpecnaut(
    ["cloud", "token", "--api-url", "https://api.specnaut.com/"],
    { SPECNAUT_CLOUD_TOKEN: "sfc_headless_xyz", PATH: Deno.env.get("PATH") ?? "" },
  );
  assertEquals(r.code, 0, r.stderr);
  assertEquals(r.stdout.trim(), "sfc_headless_xyz");
});

Deno.test("`cloud token` refuses the headless token for a deployment the environment did not name", async () => {
  for (
    const url of [
      "https://api.example.com",
      "http://api.specnaut.com",
      "https://api.specnaut.com.evil.test",
    ]
  ) {
    const r = await runSpecnaut(
      ["cloud", "token", "--api-url", url],
      { SPECNAUT_CLOUD_TOKEN: "sfc_headless_xyz", PATH: Deno.env.get("PATH") ?? "" },
    );
    assertEquals(r.code, 1, url);
    assertEquals(r.stdout.includes("sfc_headless_xyz"), false, url);
    assertStringIncludes(r.stderr, "is not sent to", url);
  }
});

Deno.test("`cloud token` with no env + no stored creds → exit 1 with guidance", async () => {
  // HOME points at an empty temp dir so there's no credentials file to find.
  const home = await Deno.makeTempDir({ prefix: "specnaut-nohome-" });
  try {
    const r = await runSpecnaut(
      ["cloud", "token", "--api-url", "https://api.example.com"],
      { HOME: home, PATH: Deno.env.get("PATH") ?? "" },
    );
    assertEquals(r.code, 1);
    assertStringIncludes(r.stderr, "cloud login");
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});
